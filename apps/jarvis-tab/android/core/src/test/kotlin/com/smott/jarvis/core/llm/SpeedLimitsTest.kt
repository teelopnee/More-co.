package com.smott.jarvis.core.llm

import com.smott.jarvis.core.agent.Agent
import com.smott.jarvis.core.agent.ResearchContext
import com.smott.jarvis.core.market.MarketService
import com.smott.jarvis.core.net.Http
import com.smott.jarvis.core.providers.FinnhubClient
import com.smott.jarvis.core.providers.TwelveDataClient
import com.smott.jarvis.core.tools.Schema
import com.smott.jarvis.core.tools.Tool
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import java.net.SocketException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** ความเร็วและความทน: ไม่ค้างนาน ไม่ล้มเพราะเน็ตสะดุดครั้งเดียว และไม่ค้นวนไม่จบ */
class SpeedLimitsTest {
    private fun http(handler: (model: String, body: String) -> Pair<Int, String>) = Http(
        OkHttpClient.Builder().addInterceptor(Interceptor { chain ->
            val req = chain.request()
            val body = Buffer().also { req.body!!.writeTo(it) }.readUtf8()
            val model = Json.parseToJsonElement(body).jsonObject["model"].toString().trim('"')
            val (code, text) = handler(model, body)
            Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(code).message("x")
                .body(text.toResponseBody("application/json".toMediaType())).build()
        }).build()
    )

    private val ok = """{"choices":[{"message":{"role":"assistant","content":"hi"}}]}"""
    private val ask = listOf(ChatMessage("user", "x"))

    /** "Software caused connection abort" (เจอจริงตอนสลับแอป) → ลองใหม่เองในรุ่นเดิม ไม่ล้มทั้งคำถาม */
    @Test
    fun connectionAbortIsRetried() = runBlocking {
        var calls = 0
        val h = http { _, _ -> if (++calls == 1) throw SocketException("Software caused connection abort") else 200 to ok }
        val llm = OpenAiCompatClient(h, netRetryDelayMs = 10) { LlmConfig(ModelCatalog.GEMINI_BASE, "k", "m") }
        assertEquals("hi", llm.complete(ask, emptyList(), ToolChoice.Auto).content)
        assertEquals(2, calls)
    }

    /** ทุกรุ่นค้างเงียบ → เลิกรอตามเวลารวม และบอกเป็นภาษาคน ไม่ค้างเป็นนาที ๆ */
    @Test
    fun slowModelsGiveUpWithinTheBudget() = runBlocking {
        val tried = mutableListOf<String>()
        val h = http { model, _ -> tried += model; Thread.sleep(2_000); 200 to ok }
        val llm = OpenAiCompatClient(h, perModelTimeoutMs = 300, callBudgetMs = 1_000) {
            LlmConfig(ModelCatalog.GEMINI_BASE, "k", "a", fallbacks = listOf("b", "c", "d", "e"))
        }
        val started = System.currentTimeMillis()
        val e = assertFailsWith<LlmException> { llm.complete(ask, emptyList(), ToolChoice.Auto) }
        val took = System.currentTimeMillis() - started
        println("เลิกรอหลัง ${took}ms ลองแล้ว $tried: ${e.message}")
        assertTrue(took < 1_500, "ต้องเลิกรอภายในเวลารวม (ใช้ไป $took ms)")
        assertTrue("ช้าเกินไป" in e.message.orEmpty())
        assertTrue(tried.size in 2..4)
    }

    /** Gemini ได้ reasoning_effort=low (เร็วขึ้น) ถ้ารุ่นไหนไม่รับก็ส่งใหม่โดยไม่มีช่องนี้ ผู้ให้บริการอื่นไม่ได้รับ */
    @Test
    fun lowReasoningOnlyForGemini() = runBlocking {
        val bodies = mutableListOf<String>()
        val h = http { model, body ->
            bodies += body
            if (model == "old" && "reasoning_effort" in body) 400 to """{"error":{"message":"Invalid value for reasoning_effort"}}""" else 200 to ok
        }
        OpenAiCompatClient(h) { LlmConfig(ModelCatalog.GEMINI_BASE, "k", "new") }.complete(ask, emptyList(), ToolChoice.Auto)
        assertTrue("\"reasoning_effort\":\"low\"" in bodies.last())
        val old = OpenAiCompatClient(h) { LlmConfig(ModelCatalog.GEMINI_BASE, "k", "old") }
        assertEquals("hi", old.complete(ask, emptyList(), ToolChoice.Auto).content)
        assertTrue("reasoning_effort" !in bodies.last())
        old.complete(ask, emptyList(), ToolChoice.Auto)
        assertEquals(4, bodies.size, "จำไว้แล้ว ไม่ส่งช่องที่ถูกปฏิเสธซ้ำ")
        OpenAiCompatClient(h) { LlmConfig(ModelCatalog.OPENROUTER_BASE, "k", "x") }.complete(ask, emptyList(), ToolChoice.Auto)
        assertTrue("reasoning_effort" !in bodies.last())
    }

    /** โมเดลอยากค้นต่อไม่หยุด → ครบ 3 รอบแล้วถูกบังคับให้สรุปจากที่มี */
    @Test
    fun researchStopsAfterThreeRounds() = runBlocking {
        val forced = mutableListOf<Boolean>()
        var n = 0
        val llm = object : LlmClient {
            override suspend fun complete(messages: List<ChatMessage>, tools: List<ToolDef>, toolChoice: JsonElement): ChatMessage {
                val isForced = toolChoice is JsonObject
                forced += isForced
                n++
                return if (isForced) {
                    assertTrue(messages.last().content.orEmpty().startsWith("Time is up"))
                    ChatMessage("assistant", toolCalls = listOf(ToolCall("f", function = FunctionCall("present_briefing", """{"title":"t","overview":{"headline":"สรุปจาก 3 รอบ"}}"""))))
                } else {
                    ChatMessage("assistant", toolCalls = listOf(ToolCall("c$n", function = FunctionCall("dig", "{}"))))
                }
            }
        }
        var digs = 0
        val dig = object : Tool {
            override val name = "dig"
            override val description = "dig"
            override val parameters = Schema.obj()
            override fun traceLabel(args: JsonObject) = "ค้น" to ""
            override suspend fun run(args: JsonObject, ctx: ResearchContext): String = "more ${++digs}"
        }
        val h = http { _, _ -> 500 to "" }
        val agent = Agent(llm, { listOf(dig) }, MarketService(FinnhubClient(h) { "" }, TwelveDataClient(h) { "" }))
        val r = agent.run("ค้นไปเรื่อย ๆ", emptyList()) {}
        assertEquals("สรุปจาก 3 รอบ", r.briefing.overview?.headline)
        assertEquals(3, digs)
        assertEquals(listOf(false, false, false, true), forced)
    }

    /** 503 ชั่วครู่ทุกรุ่น → วนกลับมาลองอีกรอบ (ไม่ยอมแพ้ตั้งแต่รอบแรก); โควตารายวันหมด → ไม่ลองรุ่นนั้นซ้ำ */
    @Test
    fun overloadedModelsAreTriedAgainButDailyQuotaIsNot() = runBlocking {
        val tried = mutableListOf<String>()
        val daily = """{"error":{"code":429,"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash, description: Generate content requests per day limit exceeded on Free Tier.\nPlease retry in 16h31m4.8s."}}"""
        var liteCalls = 0
        val h = http { model, _ ->
            tried += model
            when {
                model == "flash" -> 429 to daily
                ++liteCalls < 2 -> 503 to """{"error":{"code":503,"message":"This model is currently experiencing high demand."}}"""
                else -> 200 to ok
            }
        }
        val llm = OpenAiCompatClient(h) { LlmConfig(ModelCatalog.GEMINI_BASE, "k", "lite", fallbacks = listOf("flash")) }
        assertEquals("hi", llm.complete(ask, emptyList(), ToolChoice.Auto).content)
        assertEquals(listOf("lite", "flash", "lite"), tried)
        tried.clear()
        llm.complete(ask, emptyList(), ToolChoice.Auto)
        assertEquals(listOf("lite"), tried, "รุ่นที่โควตาวันนี้หมดถูกพักไว้ ไม่ถูกลองก่อน")
    }

    /** ค้นได้ที่มาแล้วแต่สมองล่มตอนสรุป → ได้คำตอบที่แสดงแหล่งข้อมูล ไม่ใช่ข้อผิดพลาด */
    @Test
    fun brainFailingAfterResearchStillShowsSources() = runBlocking {
        var n = 0
        val llm = object : LlmClient {
            override suspend fun complete(messages: List<ChatMessage>, tools: List<ToolDef>, toolChoice: JsonElement): ChatMessage {
                if (n++ > 0) throw LlmException("สมอง AI ตอบช้าเกินไป")
                return ChatMessage("assistant", toolCalls = listOf(ToolCall("c", function = FunctionCall("dig", "{}"))))
            }
        }
        val dig = object : Tool {
            override val name = "dig"
            override val description = "dig"
            override val parameters = Schema.obj()
            override fun traceLabel(args: JsonObject) = "ค้น" to ""
            override suspend fun run(args: JsonObject, ctx: ResearchContext): String {
                val s = ctx.register(com.smott.jarvis.core.model.SourceKind.NEWS, "Quest 3S ลดราคา", "https://example.com/a")
                return "found ${s.id}"
            }
        }
        val h = http { _, _ -> 500 to "" }
        val r = Agent(llm, { listOf(dig) }, MarketService(FinnhubClient(h) { "" }, TwelveDataClient(h) { "" })).run("แว่น VR", emptyList()) {}
        val o = r.briefing.overview!!
        assertTrue("ไม่ว่าง" in o.headline)
        assertEquals("Quest 3S ลดราคา", o.points.single().text)
        assertEquals(listOf("แว่น VR"), r.briefing.followUps)
    }
}
