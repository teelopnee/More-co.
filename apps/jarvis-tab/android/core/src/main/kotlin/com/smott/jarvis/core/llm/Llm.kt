package com.smott.jarvis.core.llm

import com.smott.jarvis.core.ConfigException
import com.smott.jarvis.core.JarvisJson
import com.smott.jarvis.core.net.Http
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

data class LlmConfig(val baseUrl: String, val apiKey: String, val model: String)

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
)

@Serializable
data class ToolCall(
    val id: String = "",
    val type: String = "function",
    val function: FunctionCall = FunctionCall(),
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

    override suspend fun complete(
        messages: List<ChatMessage>,
        tools: List<ToolDef>,
        toolChoice: JsonElement,
    ): ChatMessage {
        val cfg = config()
        if (cfg.apiKey.isBlank()) throw ConfigException("ยังไม่ได้ใส่ API key ของโมเดล — เปิดหน้าตั้งค่าแล้วใส่คีย์ OpenRouter")
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
        val text = withRetry(retries = 1) { http.postJson(url, body, headers) }
        val response = JarvisJson.decodeFromString(ChatResponse.serializer(), text)
        response.error?.let { throw LlmException("โมเดลแจ้งข้อผิดพลาด: ${it.message}") }
        return response.choices.firstOrNull()?.message
            ?: throw LlmException("โมเดลไม่ส่งคำตอบกลับมา")
    }
}
