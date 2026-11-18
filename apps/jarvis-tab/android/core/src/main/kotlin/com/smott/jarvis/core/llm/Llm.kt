package com.smott.jarvis.core.llm

import com.smott.jarvis.core.ConfigException
import com.smott.jarvis.core.JarvisJson
import com.smott.jarvis.core.net.Http
import com.smott.jarvis.core.net.HttpError
import com.smott.jarvis.core.net.withRetry
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

class OpenAiCompatClient(
    private val http: Http,
    private val config: () -> LlmConfig,
) : LlmClient {

    /**
     * บางผู้ให้บริการ/โมเดลฟรีไม่รองรับการบังคับเรียกเครื่องมือตัวใดตัวหนึ่ง (tool_choice แบบระบุชื่อ)
     * ถ้าถูกปฏิเสธจะลดเป็น "required" แล้วเป็น "auto" และจำไว้ต่อโมเดล ไม่ต้องลองซ้ำทุกครั้ง
     */
    private val choiceLevel = java.util.concurrent.ConcurrentHashMap<String, Int>()

    override suspend fun complete(
        messages: List<ChatMessage>,
        tools: List<ToolDef>,
        toolChoice: JsonElement,
    ): ChatMessage {
        val base = config()
        if (base.apiKey.isBlank()) throw ConfigException("ยังไม่ได้ใส่ API key ของสมอง — เปิดหน้าตั้งค่าแล้วใส่คีย์ (Gemini ใช้ฟรีได้)")
        val models = (listOf(base.model) + base.fallbacks).filter { it.isNotBlank() }.distinct()
        // รุ่นที่เพิ่งไม่ว่างจะถูกข้ามไปชั่วคราว 10 นาที แล้วค่อยกลับมาลองใหม่
        val now = System.currentTimeMillis()
        val ordered = models.filter { (busyUntil[base.baseUrl + "|" + it] ?: 0L) <= now } + models.filter { (busyUntil[base.baseUrl + "|" + it] ?: 0L) > now }
        var last: Exception? = null
        for ((i, model) in ordered.withIndex()) {
            // มีรุ่นสำรอง = ไม่ลองรุ่นเดิมซ้ำ เปลี่ยนรุ่นเลย (เร็วกว่าและได้ผลกว่าเมื่อรุ่นนั้นคนใช้เยอะ)
            val hasNext = i < ordered.lastIndex
            val retries = if (hasNext) 0 else 1
            try {
                if (!hasNext) return completeWith(base.copy(model = model), messages, tools, toolChoice, retries)
                // ยังมีรุ่นสำรอง: รอได้ไม่เกิน 60 วินาที (แผนฟรีบางครั้งค้างเงียบ ๆ จนหมดเวลา 2 นาที)
                val reply = kotlinx.coroutines.withTimeoutOrNull(PER_MODEL_TIMEOUT_MS) {
                    completeWith(base.copy(model = model), messages, tools, toolChoice, retries)
                }
                if (reply != null) return reply
                busyUntil[base.baseUrl + "|" + model] = System.currentTimeMillis() + 10 * 60_000L
                last = java.io.InterruptedIOException("$model ไม่ตอบใน ${PER_MODEL_TIMEOUT_MS / 1000} วินาที")
            } catch (e: HttpError) {
                if (!busy(e)) throw e
                busyUntil[base.baseUrl + "|" + model] = System.currentTimeMillis() + 10 * 60_000L
                last = e
            } catch (e: java.io.InterruptedIOException) {
                // ตอบช้าจนหมดเวลา = รุ่นนี้แน่นอยู่ ลองรุ่นถัดไป
                if (i == ordered.lastIndex) throw e
                busyUntil[base.baseUrl + "|" + model] = System.currentTimeMillis() + 10 * 60_000L
                last = e
            }
        }
        throw last ?: LlmException("โมเดลไม่ส่งคำตอบกลับมา")
    }

    private val busyUntil = java.util.concurrent.ConcurrentHashMap<String, Long>()

    private companion object {
        const val PER_MODEL_TIMEOUT_MS = 60_000L
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
        retries: Int,
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
            try {
                return send(cfg, messages, tools, choice, retries)
            } catch (e: HttpError) {
                val aboutTools = e.code in 400..422 && e.body.contains("tool", ignoreCase = true)
                if (!forced || level >= 2 || !aboutTools) throw e
                level++
                choiceLevel[key] = level
            }
        }
    }

    private suspend fun send(cfg: LlmConfig, messages: List<ChatMessage>, tools: List<ToolDef>, toolChoice: JsonElement, retries: Int): ChatMessage {
        val request = ChatRequest(
            model = cfg.model,
            messages = messages,
            tools = tools.ifEmpty { null },
            toolChoice = if (tools.isEmpty()) null else toolChoice,
        )
        val body = JarvisJson.encodeToString(ChatRequest.serializer(), request)
        val url = cfg.baseUrl.trimEnd('/') + "/chat/completions"
        val headers = mapOf(
            "Authorization" to "Bearer ${cfg.apiKey}",
            "X-Title" to "Jarvis Tab",
        )
        val text = withRetry(retries = retries) { http.postJson(url, body, headers) }
        val response = JarvisJson.decodeFromString(ChatResponse.serializer(), text)
        response.error?.let { throw LlmException("โมเดลแจ้งข้อผิดพลาด: ${it.message}") }
        return response.choices.firstOrNull()?.message
            ?: throw LlmException("โมเดลไม่ส่งคำตอบกลับมา")
    }
}
