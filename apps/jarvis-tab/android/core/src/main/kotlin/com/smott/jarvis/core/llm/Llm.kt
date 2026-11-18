package com.smott.jarvis.core.llm

import com.smott.jarvis.core.ConfigException
import com.smott.jarvis.core.JarvisJson
import com.smott.jarvis.core.net.Http
import com.smott.jarvis.core.net.HttpError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException
import java.io.InterruptedIOException
import java.net.UnknownHostException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonTransformingSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/*
 * ไคลเอนต์แบบ OpenAI-compatible (/chat/completions + tools)
 * ใช้ได้กับ OpenRouter (ค่าเริ่มต้น), OpenAI, หรือผู้ให้บริการอื่นที่รองรับรูปแบบเดียวกัน
 */

/** fallbacks = รุ่นที่ลองต่อเมื่อรุ่นหลักไม่ว่าง (503) หรือโควตาของรุ่นนั้นหมด (429) */
data class LlmConfig(val baseUrl: String, val apiKey: String, val model: String, val fallbacks: List<String> = emptyList())

interface LlmClient {
    suspend fun complete(messages: List<ChatMessage>, tools: List<ToolDef>, toolChoice: JsonElement): ChatMessage
}

class LlmException(message: String) : Exception(message)

object ToolChoice {
    val Auto: JsonElement = JsonPrimitive("auto")
    fun force(name: String): JsonElement = buildJsonObject {
        put("type", "function")
        putJsonObject("function") { put("name", name) }
    }
}

@Serializable
data class ChatMessage(
    val role: String,
    @Serializable(with = ContentFlex::class) val content: String? = null,
    @SerialName("tool_calls") val toolCalls: List<ToolCall>? = null,
    @SerialName("tool_call_id") val toolCallId: String? = null,
    /** ข้อมูลเฉพาะผู้ให้บริการ (เช่น thought_signature ของ Gemini) — ต้องส่งกลับไปตามเดิม */
    @SerialName("extra_content") val extraContent: JsonObject? = null,
)

@Serializable
data class ToolCall(
    val id: String = "",
    val type: String = "function",
    val function: FunctionCall = FunctionCall(),
    /**
     * Gemini 3+ แนบ {"google":{"thought_signature":…}} มากับการเรียกเครื่องมือ และบังคับให้ส่งกลับมาครบในรอบถัดไป
     * (ไม่ส่ง = HTTP 400 "Function call is missing a thought_signature") — ผู้ให้บริการอื่นไม่ส่งมา ช่องนี้จึงว่างและไม่ถูกส่ง
     */
    @SerialName("extra_content") val extraContent: JsonObject? = null,
)

@Serializable
data class FunctionCall(
    val name: String = "",
    @Serializable(with = ArgsFlex::class) val arguments: String = "{}",
)

@Serializable
data class ToolDef(val type: String = "function", val function: FunctionDef)

@Serializable
data class FunctionDef(val name: String, val description: String, val parameters: JsonObject)

@Serializable
data class ChatRequest(
    val model: String,
    val messages: List<ChatMessage>,
    val tools: List<ToolDef>? = null,
    @SerialName("tool_choice") val toolChoice: JsonElement? = null,
    val temperature: Double = 0.3,
    @SerialName("max_tokens") val maxTokens: Int = 6000,
    /** Gemini: "low" = คิดสั้นลง ตอบเร็วขึ้นราว 2 เท่า (วัดจริง พ.ย. 2026) — ผู้ให้บริการอื่นไม่ส่งช่องนี้ */
    @SerialName("reasoning_effort") val reasoningEffort: String? = null,
)

@Serializable
data class ChatResponse(
    val choices: List<Choice> = emptyList(),
    val error: ApiError? = null,
)

@Serializable
data class Choice(
    val message: ChatMessage = ChatMessage(role = "assistant"),
    @SerialName("finish_reason") val finishReason: String? = null,
)

@Serializable
data class ApiError(val message: String = "")

/** บางผู้ให้บริการส่ง content เป็น array ของ {type,text} — รวมเป็นข้อความเดียว */
object ContentFlex : JsonTransformingSerializer<String>(String.serializer()) {
    override fun transformDeserialize(element: JsonElement): JsonElement = when (element) {
        is JsonArray -> JsonPrimitive(
            element.joinToString("") { part ->
                when (part) {
                    is JsonObject -> (part["text"] as? JsonPrimitive)?.contentOrNull.orEmpty()
                    is JsonPrimitive -> part.contentOrNull.orEmpty()
                    else -> ""
                }
            }
        )
        is JsonObject -> JsonPrimitive((element["text"] as? JsonPrimitive)?.contentOrNull.orEmpty())
        else -> element
    }
}

/** arguments ควรเป็น string แต่บางผู้ให้บริการส่งเป็น object มาเลย */
object ArgsFlex : JsonTransformingSerializer<String>(String.serializer()) {
    override fun transformDeserialize(element: JsonElement): JsonElement = when (element) {
        is JsonObject, is JsonArray -> JsonPrimitive(element.toString())
        else -> element
    }
}

/**
 * perModelTimeoutMs = รอรุ่นหนึ่งได้นานสุดเท่าไรเมื่อยังมีรุ่นสำรอง
 * callBudgetMs = เวลารวมของการถาม 1 ครั้ง (ทุกรุ่นรวมกัน) — ไม่ให้ค้างนานเป็นนาที ๆ เมื่อทุกรุ่นช้า
 */
class OpenAiCompatClient(
    private val http: Http,
    private val perModelTimeoutMs: Long = 30_000L,
    private val callBudgetMs: Long = 75_000L,
    private val netRetryDelayMs: Long = 1_500L,
    private val config: () -> LlmConfig,
) : LlmClient {

    /**
     * บางผู้ให้บริการ/โมเดลฟรีไม่รองรับการบังคับเรียกเครื่องมือตัวใดตัวหนึ่ง (tool_choice แบบระบุชื่อ)
     * ถ้าถูกปฏิเสธจะลดเป็น "required" แล้วเป็น "auto" และจำไว้ต่อโมเดล ไม่ต้องลองซ้ำทุกครั้ง
     */
    private val choiceLevel = java.util.concurrent.ConcurrentHashMap<String, Int>()

    /** รุ่นที่ไม่รับ reasoning_effort (จำไว้ ไม่ส่งอีก) */
    private val noReasoning = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    /** รุ่นที่เพิ่งไม่ว่างจะถูกข้ามไปชั่วคราว 10 นาที แล้วค่อยกลับมาลองใหม่ */
    private val busyUntil = java.util.concurrent.ConcurrentHashMap<String, Long>()

    override suspend fun complete(
        messages: List<ChatMessage>,
        tools: List<ToolDef>,
        toolChoice: JsonElement,
    ): ChatMessage {
        val base = config()
        if (base.apiKey.isBlank()) throw ConfigException("ยังไม่ได้ใส่ API key ของสมอง — เปิดหน้าตั้งค่าแล้วใส่คีย์ (Gemini ใช้ฟรีได้)")
        val models = (listOf(base.model) + base.fallbacks).filter { it.isNotBlank() }.distinct()
        val now = System.currentTimeMillis()
        fun key(model: String) = base.baseUrl + "|" + model
        val ordered = models.filter { (busyUntil[key(it)] ?: 0L) <= now } + models.filter { (busyUntil[key(it)] ?: 0L) > now }
        val started = System.currentTimeMillis()
        var last: Exception? = null
        var timedOut = 0
        var queue = ordered
        var pass = 0
        // แผนฟรีมักตอบ 503 "high demand" แบบชั่วครู่ → วนลองรุ่นที่ตอบ 503 อีกรอบได้ จนหมดเวลารวม
        while (queue.isNotEmpty()) {
            val again = mutableListOf<String>()
            for ((i, model) in queue.withIndex()) {
                val left = callBudgetMs - (System.currentTimeMillis() - started)
                if ((pass > 0 || i > 0) && left < minOf(MIN_ATTEMPT_MS, perModelTimeoutMs / 4)) return giveUp(last, timedOut, started)
                // มีรุ่นเดียว (เช่นรุ่นเสียเงินบน OpenRouter) ให้เวลาเต็มที่ มีรุ่นสำรอง = ไม่รอรุ่นที่ค้าง
                val limit = if (ordered.size == 1) left else minOf(perModelTimeoutMs, left)
                try {
                    val reply = withTimeoutOrNull(limit) {
                        attempt(base.copy(model = model), messages, tools, toolChoice)
                    }
                    if (reply != null) {
                        busyUntil.remove(key(model))
                        return reply
                    }
                    busyUntil[key(model)] = System.currentTimeMillis() + SLOW_BUSY_MS
                    timedOut++
                    last = LlmException("$model ไม่ตอบใน ${limit / 1000} วินาที")
                } catch (e: HttpError) {
                    if (!busy(e)) throw e
                    // 404 = รุ่นถูกปิดไปแล้ว ไม่ต้องลองอีก
                    val wait = if (e.code == 404) GONE_MS else quotaWaitMs(e)
                    busyUntil[key(model)] = System.currentTimeMillis() + (wait ?: SHORT_BUSY_MS)
                    if (wait == null) again += model
                    last = e
                } catch (e: InterruptedIOException) {
                    // อ่านคำตอบไม่ทันเวลาของ OkHttp = รุ่นนี้แน่นอยู่
                    busyUntil[key(model)] = System.currentTimeMillis() + SLOW_BUSY_MS
                    timedOut++
                    last = e
                } catch (e: IOException) {
                    // เน็ตหลุดซ้ำหลายครั้ง (ลองใหม่ในรุ่นเดิมแล้ว) — ไม่ใช่ความผิดของรุ่น
                    again += model
                    last = e
                }
            }
            if (again.isEmpty() || ++pass >= MAX_PASSES) break
            delay(PASS_DELAY_MS)
            queue = again
        }
        return giveUp(last, timedOut, started)
    }

    private fun giveUp(last: Exception?, timedOut: Int, started: Long): Nothing {
        if (timedOut > 0 && (last !is HttpError || last.code >= 500)) {
            val secs = (System.currentTimeMillis() - started) / 1000
            throw LlmException("สมอง AI ตอบช้าเกินไป (รอแล้ว $secs วินาที) — ช่วงนี้รุ่นฟรีคนใช้เยอะ ลองใหม่อีกครั้ง")
        }
        throw last ?: LlmException("โมเดลไม่ส่งคำตอบกลับมา")
    }

    /**
     * 429 ของโควตารายวัน (แผนฟรี Gemini 3.8 Flash ได้แค่ 20 ครั้ง/วัน) → พักรุ่นนั้นจนโควตารีเซ็ต
     * 429 รายนาที → null (ลองรอบถัดไปได้)
     */
    private fun quotaWaitMs(e: HttpError): Long? {
        if (e.code != 429) return null
        val daily = e.body.contains("per day", true) || e.body.contains("PerDay", true)
        if (!daily) return null
        val m = Regex("retry in (?:(\\d+)h)?(?:(\\d+)m)?(?:([\\d.]+)s)?", RegexOption.IGNORE_CASE).find(e.body)
        val ms = m?.let {
            val (h, min, sec) = it.destructured
            (h.toLongOrNull() ?: 0) * 3_600_000 + (min.toLongOrNull() ?: 0) * 60_000 + ((sec.toDoubleOrNull() ?: 0.0) * 1000).toLong()
        }?.takeIf { it > 0 }
        return (ms ?: 6 * 3_600_000L).coerceAtMost(24 * 3_600_000L)
    }

    /**
     * ส่ง 1 ครั้งกับรุ่นเดียว: เน็ตสะดุด (เช่น "Software caused connection abort" ตอนสลับแอป/สลับ Wi-Fi)
     * ลองใหม่ในรุ่นเดิมได้ 2 ครั้ง
     */
    private suspend fun attempt(
        cfg: LlmConfig,
        messages: List<ChatMessage>,
        tools: List<ToolDef>,
        toolChoice: JsonElement,
    ): ChatMessage {
        var net = 0
        while (true) {
            try {
                return completeWith(cfg, messages, tools, toolChoice)
            } catch (e: CancellationException) {
                throw e
            } catch (e: HttpError) {
                throw e
            } catch (e: InterruptedIOException) {
                throw e
            } catch (e: UnknownHostException) {
                if (net++ >= 1) throw e
                delay(netRetryDelayMs)
            } catch (e: IOException) {
                if (net++ >= NET_RETRIES) throw e
                delay(netRetryDelayMs * net)
            }
        }
    }

    private companion object {
        /** 503/500 ชั่วครู่ */
        const val SHORT_BUSY_MS = 90_000L
        /** ค้างเงียบจนหมดเวลา */
        const val SLOW_BUSY_MS = 5 * 60_000L
        const val GONE_MS = 6 * 3_600_000L
        const val MIN_ATTEMPT_MS = 8_000L
        const val NET_RETRIES = 2
        const val MAX_PASSES = 3
        const val PASS_DELAY_MS = 1_500L
    }

    /** รุ่นนี้ไม่ว่างชั่วคราว (ล่ม/คนใช้เยอะ) หรือโควตาของรุ่นนี้หมด — แผนฟรีโควตาแยกต่อรุ่น จึงลองรุ่นอื่นได้ */
    private fun busy(e: HttpError): Boolean = e.code == 429 || e.code == 529 || e.code in 500..504 ||
        // รุ่นที่ถูกปิดไปแล้ว ("no longer available to new users") — ข้ามไปรุ่นถัดไป
        (e.code == 404 && e.body.contains("model", ignoreCase = true))

    private suspend fun completeWith(
        cfg: LlmConfig,
        messages: List<ChatMessage>,
        tools: List<ToolDef>,
        toolChoice: JsonElement,
    ): ChatMessage {
        val key = cfg.baseUrl + "|" + cfg.model
        val forced = toolChoice is JsonObject
        var level = if (forced) choiceLevel[key] ?: 0 else 2
        while (true) {
            val choice: JsonElement = when {
                !forced -> toolChoice
                level == 0 -> toolChoice
                level == 1 -> JsonPrimitive("required")
                else -> JsonPrimitive("auto")
            }
            val effort = if (cfg.baseUrl.trimEnd('/') == ModelCatalog.GEMINI_BASE && key !in noReasoning) "low" else null
            try {
                return send(cfg, messages, tools, choice, effort)
            } catch (e: HttpError) {
                if (effort != null && e.code == 400 && (e.body.contains("reasoning", true) || e.body.contains("thinking", true))) {
                    noReasoning += key
                    continue
                }
                val aboutTools = e.code in 400..422 && e.body.contains("tool", ignoreCase = true)
                if (!forced || level >= 2 || !aboutTools) throw e
                level++
                choiceLevel[key] = level
            }
        }
    }

    private suspend fun send(cfg: LlmConfig, messages: List<ChatMessage>, tools: List<ToolDef>, toolChoice: JsonElement, effort: String?): ChatMessage {
        val request = ChatRequest(
            model = cfg.model,
            messages = messages,
            tools = tools.ifEmpty { null },
            toolChoice = if (tools.isEmpty()) null else toolChoice,
            reasoningEffort = effort,
        )
        val body = JarvisJson.encodeToString(ChatRequest.serializer(), request)
        val url = cfg.baseUrl.trimEnd('/') + "/chat/completions"
        val headers = mapOf(
            "Authorization" to "Bearer ${cfg.apiKey}",
            "X-Title" to "Jarvis Tab",
        )
        val text = http.postJson(url, body, headers)
        val response = JarvisJson.decodeFromString(ChatResponse.serializer(), text)
        response.error?.let { throw LlmException("โมเดลแจ้งข้อผิดพลาด: ${it.message}") }
        return response.choices.firstOrNull()?.message
            ?: throw LlmException("โมเดลไม่ส่งคำตอบกลับมา")
    }
}
