package com.smott.jarvis.core.llm

import com.smott.jarvis.core.agent.Agent
import com.smott.jarvis.core.market.MarketService
import com.smott.jarvis.core.net.Http
import com.smott.jarvis.core.providers.FinnhubClient
import com.smott.jarvis.core.providers.TwelveDataClient
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import kotlin.test.Test
import kotlin.test.assertEquals

class ModelCatalogTest {
    @Test
    fun picksNewestStableFlash() {
        val ids = listOf(
            "gemini-2.5-flash", "gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.8-flash-image", "gemini-3.8-flash-preview-tts",
            "gemini-3.5-flash-lite", "gemini-4-hydrogen", "text-embedding-004", "gemini-3.8-flash-live", "imagen-4",
        )
        assertEquals("gemini-3.8-flash", ModelCatalog.pickGemini(ids))
        assertEquals("gemini-3.5-flash-lite", ModelCatalog.pickGemini(listOf("gemini-3.5-flash-lite", "text-embedding-004")))
        assertEquals("gemini-4-hydrogen", ModelCatalog.pickGemini(listOf("gemini-4-hydrogen", "imagen-4")))
        assertEquals(null, ModelCatalog.pickGemini(listOf("imagen-4")))
    }

    @Test
    fun orderedFallbacksFromTheLiveList() {
        // รายชื่อจริงบางส่วนจาก Google (พ.ย. 2026)
        val ids = listOf(
            "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-preview-tts", "gemini-flash-latest", "gemini-flash-lite-latest",
            "gemini-2.5-flash-lite", "gemini-2.5-flash-image", "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-3.5-flash",
            "gemini-3.5-flash-lite", "gemini-omni-1.2-flash", "gemini-3.5-transcribe", "gemini-3.6-flash", "gemini-3.7-flash",
            "gemini-3.8-flash", "gemini-4-hydrogen", "gemini-3.8-flash-tts", "gemini-3.8-live", "gemini-embedding-2",
        )
        assertEquals(
            listOf("gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-3.7-flash", "gemini-flash-latest", "gemini-3.6-flash"),
            ModelCatalog.geminiCandidates(ids),
        )
        assertEquals(
            listOf("gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-flash-latest"),
            ModelCatalog.geminiCandidates(listOf("gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-flash-lite-latest")),
        )
    }

    /** รุ่นแรกตอบ 503 "high demand" (เจอจริงกับแผนฟรี) → ใช้รุ่นถัดไปเอง และครั้งต่อไปไม่ลองรุ่นที่ไม่ว่างก่อน */
    @Test
    fun switchesModelWhenOneIsOverloaded() = runBlocking {
        val used = mutableListOf<String>()
        val http = Http(OkHttpClient.Builder().addInterceptor(Interceptor { chain ->
            val req = chain.request()
            val model = Json.parseToJsonElement(Buffer().also { req.body!!.writeTo(it) }.readUtf8()).jsonObject["model"].toString().trim('"')
            used += model
            val (code, text) = if (model == "busy-model") {
                503 to """[{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}]"""
            } else {
                200 to """{"choices":[{"message":{"role":"assistant","content":"hi"}}]}"""
            }
            Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(code).message("x")
                .body(text.toResponseBody("application/json".toMediaType())).build()
        }).build())
        val llm = OpenAiCompatClient(http) { LlmConfig(ModelCatalog.GEMINI_BASE, "k", "busy-model", fallbacks = listOf("ok-model")) }
        assertEquals("hi", llm.complete(listOf(ChatMessage("user", "x")), emptyList(), ToolChoice.Auto).content)
        assertEquals("hi", llm.complete(listOf(ChatMessage("user", "x")), emptyList(), ToolChoice.Auto).content)
        // ไม่ลองรุ่นที่ไม่ว่างซ้ำ เปลี่ยนรุ่นทันที; ครั้งที่สองไปที่รุ่นที่ว่างเลย
        assertEquals(listOf("busy-model", "ok-model", "ok-model"), used)
    }

    /** Gemini 3+: thought_signature ที่มากับการเรียกเครื่องมือต้องถูกส่งกลับในรอบถัดไปแบบไม่แตะต้อง */
    @Test
    fun echoesGeminiThoughtSignatureBack() = runBlocking {
        val bodies = mutableListOf<String>()
        var n = 0
        val http = Http(OkHttpClient.Builder().addInterceptor(Interceptor { chain ->
            val req = chain.request()
            bodies += Buffer().also { req.body!!.writeTo(it) }.readUtf8()
            val text = if (n++ == 0) {
                """{"choices":[{"message":{"role":"assistant","tool_calls":[{"extra_content":{"google":{"thought_signature":"SIG123"}},"id":"c1","type":"function","function":{"name":"echo","arguments":"{}"}}]}}]}"""
            } else {
                """{"choices":[{"message":{"role":"assistant","tool_calls":[{"id":"c2","type":"function","function":{"name":"present_briefing","arguments":"{\"title\":\"t\",\"spoken\":\"s\",\"overview\":\"ok\"}"}}]}}]}"""
            }
            Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(200).message("ok")
                .body(text.toResponseBody("application/json".toMediaType())).build()
        }).build())
        val echo = object : com.smott.jarvis.core.tools.Tool {
            override val name = "echo"
            override val description = "echo"
            override val parameters = com.smott.jarvis.core.tools.Schema.obj()
            override fun traceLabel(args: kotlinx.serialization.json.JsonObject) = "echo" to ""
            override suspend fun run(args: kotlinx.serialization.json.JsonObject, ctx: com.smott.jarvis.core.agent.ResearchContext) = "ok"
        }
        val llm = OpenAiCompatClient(http) { LlmConfig(ModelCatalog.GEMINI_BASE, "k", "m") }
        val r = Agent(llm, { listOf(echo) }, MarketService(FinnhubClient(http) { "" }, TwelveDataClient(http) { "" })).run("x", emptyList()) {}
        assertEquals("ok", r.briefing.overview?.headline)
        val second = Json.parseToJsonElement(bodies[1]).jsonObject["messages"].toString()
        kotlin.test.assertTrue("\"thought_signature\":\"SIG123\"" in second, second)
        kotlin.test.assertTrue("extra_content" !in bodies[0], "ไม่ส่งช่องว่างไปให้ผู้ให้บริการอื่น")
    }

    @Test
    fun readsFreeOpenRouterModelsThatCanUseTools() = runBlocking {
        val body = """{"data":[
          {"id":"a/big:free","context_length":1000000,"supported_parameters":["tools","tool_choice"]},
          {"id":"b/small:free","context_length":8000,"supported_parameters":["tools","tool_choice"]},
          {"id":"c/notools:free","context_length":2000000,"supported_parameters":["temperature"]},
          {"id":"d/paid","context_length":3000000,"supported_parameters":["tools","tool_choice"]}
        ]}"""
        val http = Http(OkHttpClient.Builder().addInterceptor(Interceptor { chain ->
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("ok")
                .body(body.toResponseBody("application/json".toMediaType())).build()
        }).build())
        assertEquals(listOf("a/big:free", "b/small:free"), ModelCatalog.openRouterFreeModels(http))
    }

    /** ผู้ให้บริการที่ไม่รับ tool_choice แบบระบุชื่อ (เช่นบางโมเดลฟรี) → ลดเป็น "required" แล้ว "auto" และจำไว้ */
    @Test
    fun fallsBackWhenForcedToolChoiceIsRejected() = runBlocking {
        val sent = mutableListOf<String>()
        val http = Http(OkHttpClient.Builder().addInterceptor(Interceptor { chain ->
            val req = chain.request()
            val json = Json.parseToJsonElement(Buffer().also { req.body!!.writeTo(it) }.readUtf8()).jsonObject
            val choice = json["tool_choice"].toString()
            sent += choice
            val (code, text) = if (choice.startsWith("{")) {
                400 to """{"error":{"message":"tool_choice with a specific function is not supported"}}"""
            } else {
                200 to """{"choices":[{"message":{"role":"assistant","tool_calls":[{"id":"x","type":"function","function":{"name":"present_briefing","arguments":"{\"title\":\"t\",\"spoken\":\"s\",\"overview\":\"ok\"}"}}]}}]}"""
            }
            Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(code).message("x")
                .body(text.toResponseBody("application/json".toMediaType())).build()
        }).build())
        val llm = OpenAiCompatClient(http) { LlmConfig(ModelCatalog.GEMINI_BASE, "k", "gemini-x") }
        val agent = Agent(llm, { emptyList() }, MarketService(FinnhubClient(http) { "" }, TwelveDataClient(http) { "" }), maxSteps = 1)
        val r = agent.run("สวัสดี", emptyList()) {}
        assertEquals("ok", r.briefing.overview?.headline)
        assertEquals(listOf("{\"type\":\"function\",\"function\":{\"name\":\"present_briefing\"}}", "\"required\""), sent)
        // ครั้งต่อไปใช้ "required" เลย ไม่ลองแบบที่ถูกปฏิเสธซ้ำ
        agent.run("อีกครั้ง", emptyList()) {}
        assertEquals("\"required\"", sent.last())
        assertEquals(3, sent.size)
    }
}
