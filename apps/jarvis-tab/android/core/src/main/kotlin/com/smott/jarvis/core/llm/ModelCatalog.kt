package com.smott.jarvis.core.llm

import com.smott.jarvis.core.JarvisJson
import com.smott.jarvis.core.net.Http
import com.smott.jarvis.core.net.withRetry
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import okhttp3.HttpUrl.Companion.toHttpUrl

/**
 * รายชื่อโมเดลจากผู้ให้บริการโดยตรง (ไม่ฝังชื่อรุ่นไว้ในแอป เพราะรุ่นฟรีเปลี่ยนบ่อย)
 * - Gemini: ใช้ฟรีได้ด้วยคีย์จาก AI Studio (ไม่ต้องผูกบัตร)
 * - OpenRouter: เฉพาะโมเดล ":free" ที่รองรับการเรียกเครื่องมือ
 */
object ModelCatalog {
    const val GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai"
    const val OPENROUTER_BASE = "https://openrouter.ai/api/v1"

    suspend fun geminiModels(http: Http, apiKey: String): List<String> {
        val text = withRetry(1) {
            http.get("$GEMINI_BASE/models".toHttpUrl(), mapOf("Authorization" to "Bearer $apiKey"))
        }
        val data = JarvisJson.parseToJsonElement(text).jsonObject["data"] as? JsonArray ?: return emptyList()
        return data.mapNotNull { (it as? JsonObject)?.get("id")?.jsonPrimitive?.contentOrNull?.removePrefix("models/") }
    }

    /** เลือกรุ่น Flash ที่ใหม่ที่สุด (ไม่ใช่รุ่นทดลอง/ภาพ/เสียง) — เร็ว ถูก และอยู่ในแผนฟรี */
    fun pickGemini(ids: List<String>): String? {
        val skip = Regex("(image|tts|audio|live|embed|exp|preview|thinking|vision|aqa|imagen|veo|learnlm|robotics|computer)", RegexOption.IGNORE_CASE)
        val chat = ids.filter { it.startsWith("gemini") && !skip.containsMatchIn(it) }
        fun version(id: String) = Regex("gemini-(\\d+(?:\\.\\d+)?)").find(id)?.groupValues?.get(1)?.toDoubleOrNull() ?: 0.0
        val flash = chat.filter { it.contains("flash") && !it.contains("lite") }
        val lite = chat.filter { it.contains("flash-lite") }
        return (flash.ifEmpty { lite }.ifEmpty { chat })
            .sortedWith(compareByDescending<String> { version(it) }.thenBy { it.length })
            .firstOrNull()
    }

    /**
     * ลำดับรุ่นที่จะลองเมื่อรุ่นแรกไม่ว่าง — แผนฟรีเจอ 503 "high demand" บ่อย และมักเต็มพร้อมกันทั้งตระกูล Flash
     * (ทดสอบจริง พ.ย. 2026: Flash ทุกรุ่น 503 แต่ Flash-Lite ตอบได้) จึงสลับ Flash กับ Flash-Lite:
     * Flash ใหม่สุด → Lite ใหม่สุด → Flash รองลงมา → "flash-latest" → Lite รองลงมา → …
     */
    fun geminiCandidates(ids: List<String>, max: Int = 6): List<String> {
        val skip = Regex("(image|tts|audio|live|embed|exp|preview|thinking|vision|aqa|imagen|veo|learnlm|robotics|computer|omni|transcribe)", RegexOption.IGNORE_CASE)
        val chat = ids.filter { it.startsWith("gemini") && !skip.containsMatchIn(it) }
        fun version(id: String) = Regex("gemini-(\\d+(?:\\.\\d+)?)").find(id)?.groupValues?.get(1)?.toDoubleOrNull() ?: 0.0
        val flash = chat.filter { it.contains("flash") && !it.contains("lite") && version(it) > 0 }.sortedByDescending { version(it) }
        val alias = chat.filter { it == "gemini-flash-latest" }
        val lite = chat.filter { it.contains("flash-lite") && version(it) > 0 }.sortedByDescending { version(it) } +
            chat.filter { it == "gemini-flash-lite-latest" }
        val mixed = listOfNotNull(
            flash.getOrNull(0), lite.getOrNull(0), flash.getOrNull(1), alias.firstOrNull(), lite.getOrNull(1), flash.getOrNull(2),
        ) + flash.drop(3) + lite.drop(2)
        return mixed.distinct().take(max)
    }

    /** โมเดลฟรีบน OpenRouter ที่ใช้เครื่องมือได้ เรียงจาก context ยาวไปสั้น (ไม่ต้องใช้คีย์) */
    suspend fun openRouterFreeModels(http: Http): List<String> {
        val text = withRetry(1) { http.get("$OPENROUTER_BASE/models".toHttpUrl()) }
        val data = JarvisJson.parseToJsonElement(text).jsonObject["data"] as? JsonArray ?: return emptyList()
        return data.mapNotNull { e ->
            val m = e as? JsonObject ?: return@mapNotNull null
            val id = (m["id"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
            val params = (m["supported_parameters"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
            if (!id.endsWith(":free") || "tools" !in params || "tool_choice" !in params) return@mapNotNull null
            id to ((m["context_length"] as? JsonPrimitive)?.longOrNull ?: 0L)
        }.sortedByDescending { it.second }.map { it.first }
    }
}
