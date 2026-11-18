package com.smott.jarvis.core.keys

import com.smott.jarvis.core.JarvisJson
import com.smott.jarvis.core.llm.ModelCatalog
import com.smott.jarvis.core.net.Http
import com.smott.jarvis.core.net.HttpError
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.net.UnknownHostException
import java.util.Locale

/** ผลการตรวจคีย์ 1 ตัว: ok = ใช้ได้ (อาจมีคำเตือน เช่นโควตาหมดชั่วคราว) */
data class KeyCheck(val ok: Boolean, val message: String)

enum class KeyService { GEMINI, OPENROUTER, TAVILY, FINNHUB, TWELVE_DATA }

/**
 * ตรวจว่าคีย์ใช้ได้จริงไหม ด้วยปลายทางที่ถูกที่สุดของแต่ละเจ้า (ตรวจแล้ว พ.ย. 2026: คีย์ผิดได้ HTTP 401 ทุกเจ้า)
 * - Gemini: รายชื่อรุ่น (ไม่เสียโควตา)       - OpenRouter: GET /api/v1/key (ข้อมูลคีย์)
 * - Tavily: GET /usage (เครดิตที่ใช้ไป)        - Finnhub: ราคา AAPL 1 ครั้ง (ฟรี 60/นาที)
 * - Twelve Data: /api_usage (เสีย 1 เครดิตจาก 800/วัน จึงตรวจเฉพาะตอนใส่คีย์หรือเปิดหน้าตั้งค่า)
 */
class KeyChecker(private val http: Http) {

    suspend fun check(service: KeyService, rawKey: String): KeyCheck {
        val key = rawKey.trim()
        if (key.isEmpty()) return KeyCheck(false, "ยังไม่ได้ใส่คีย์")
        return try {
            when (service) {
                KeyService.GEMINI -> gemini(key)
                KeyService.OPENROUTER -> openRouter(key)
                KeyService.TAVILY -> tavily(key)
                KeyService.FINNHUB -> finnhub(key)
                KeyService.TWELVE_DATA -> twelveData(key)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: HttpError) {
            explain(e)
        } catch (e: UnknownHostException) {
            KeyCheck(false, "ตรวจไม่ได้: ไม่มีอินเทอร์เน็ต")
        } catch (e: Exception) {
            KeyCheck(false, "ตรวจไม่ได้: ${e.message?.take(120) ?: e.javaClass.simpleName}")
        }
    }

    private fun explain(e: HttpError): KeyCheck {
        val body = e.body
        return when {
            body.contains("suspended", ignoreCase = true) ->
                KeyCheck(false, "โปรเจกต์ Google ของคีย์นี้ถูกระงับ — สร้างคีย์ใหม่ในโปรเจกต์ใหม่")
            e.code == 401 || e.code == 403 || (e.code == 400 && body.contains("key", ignoreCase = true)) ->
                KeyCheck(false, "คีย์ไม่ถูกต้อง — ตรวจว่าคัดลอกมาครบ ไม่มีเว้นวรรค")
            e.code == 402 -> KeyCheck(true, "คีย์ใช้ได้ แต่เครดิตหมด")
            e.code == 429 -> KeyCheck(true, "คีย์ใช้ได้ แต่ตอนนี้ใช้ถี่เกินหรือโควตาวันนี้หมด")
            e.code >= 500 -> KeyCheck(false, "ผู้ให้บริการขัดข้องชั่วคราว ลองตรวจใหม่อีกครั้ง")
            else -> KeyCheck(false, "ตรวจไม่ผ่าน (HTTP ${e.code})")
        }
    }

    private suspend fun gemini(key: String): KeyCheck {
        val order = ModelCatalog.geminiCandidates(ModelCatalog.geminiModels(http, key))
        if (order.isEmpty()) return KeyCheck(false, "คีย์ใช้ได้ แต่ไม่พบรุ่น Flash ที่ใช้ได้")
        return KeyCheck(true, "ใช้ได้ · จะใช้ ${order.first()}" + if (order.size > 1) " (สำรองอีก ${order.size - 1} รุ่น)" else "")
    }

    private suspend fun openRouter(key: String): KeyCheck {
        val text = http.get("${ModelCatalog.OPENROUTER_BASE}/key".toHttpUrl(), mapOf("Authorization" to "Bearer $key"))
        val data = JarvisJson.parseToJsonElement(text).jsonObject["data"] as? JsonObject ?: return KeyCheck(true, "ใช้ได้")
        val freeTier = (data["is_free_tier"] as? JsonPrimitive)?.booleanOrNull == true
        val remaining = (data["limit_remaining"] as? JsonPrimitive)?.doubleOrNull
        val parts = mutableListOf("ใช้ได้")
        if (freeTier) parts += "บัญชีฟรี: รุ่น :free ได้ 50 ครั้ง/วัน"
        if (remaining != null) parts += "เครดิตคงเหลือ $" + String.format(Locale.US, "%.2f", remaining)
        return KeyCheck(true, parts.joinToString(" · "))
    }

    private suspend fun tavily(key: String): KeyCheck {
        val text = http.get("https://api.tavily.com/usage".toHttpUrl(), mapOf("Authorization" to "Bearer $key"))
        val json = JarvisJson.parseToJsonElement(text).jsonObject
        fun num(obj: String, field: String) = ((json[obj] as? JsonObject)?.get(field) as? JsonPrimitive)?.doubleOrNull
        val used = num("key", "usage") ?: num("account", "plan_usage")
        val limit = num("key", "limit") ?: num("account", "plan_limit")
        return if (used != null && limit != null) {
            KeyCheck(true, "ใช้ได้ · เดือนนี้ใช้ไป ${used.toLong()}/${limit.toLong()} เครดิต")
        } else {
            KeyCheck(true, "ใช้ได้")
        }
    }

    private suspend fun finnhub(key: String): KeyCheck {
        val url = "https://finnhub.io/api/v1/quote".toHttpUrl().newBuilder().addQueryParameter("symbol", "AAPL").build()
        val text = http.get(url, mapOf("X-Finnhub-Token" to key))
        val price = (JarvisJson.parseToJsonElement(text).jsonObject["c"] as? JsonPrimitive)?.doubleOrNull
        return KeyCheck(true, if (price != null && price > 0) "ใช้ได้ · AAPL ล่าสุด $" + String.format(Locale.US, "%.2f", price) else "ใช้ได้")
    }

    private suspend fun twelveData(key: String): KeyCheck {
        val url = "https://api.twelvedata.com/api_usage".toHttpUrl().newBuilder().addQueryParameter("apikey", key).build()
        val json = JarvisJson.parseToJsonElement(http.get(url)).jsonObject
        fun field(k: String) = (json[k] as? JsonPrimitive)?.contentOrNull
        if (field("status").equals("error", ignoreCase = true)) {
            val code = field("code")?.toIntOrNull() ?: 401
            return explain(HttpError(code, "api.twelvedata.com", field("message").orEmpty() + " key"))
        }
        val daily = field("daily_usage")
        val dailyLimit = field("plan_daily_limit")
        return KeyCheck(true, if (daily != null && dailyLimit != null) "ใช้ได้ · วันนี้ใช้ไป $daily/$dailyLimit ครั้ง" else "ใช้ได้")
    }
}
