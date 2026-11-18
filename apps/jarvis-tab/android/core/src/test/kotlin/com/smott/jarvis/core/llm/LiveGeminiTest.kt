package com.smott.jarvis.core.llm

import com.smott.jarvis.core.agent.Agent
import com.smott.jarvis.core.agent.ResearchContext
import com.smott.jarvis.core.market.MarketService
import com.smott.jarvis.core.model.SourceKind
import com.smott.jarvis.core.net.Http
import com.smott.jarvis.core.providers.FinnhubClient
import com.smott.jarvis.core.providers.TavilyClient
import com.smott.jarvis.core.providers.TwelveDataClient
import com.smott.jarvis.core.tools.FindVideosTool
import com.smott.jarvis.core.tools.QuotesTool
import com.smott.jarvis.core.tools.Schema
import com.smott.jarvis.core.tools.Tool
import com.smott.jarvis.core.tools.WebSearchTool
import com.smott.jarvis.core.tools.int
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * ทดสอบกับ Gemini ของจริง (แผนฟรี) — ข้ามเมื่อไม่ได้ตั้ง JARVIS_LIVE_GEMINI=1
 * คีย์อ่านจาก GEMINI_API_KEY; ข้อมูลค้นเว็บ/หุ้น/คลิปเป็นคำตอบสำเร็จรูป (ไม่ต้องมีคีย์ Tavily/Finnhub)
 */
class LiveGeminiTest {
    private val live = System.getenv("JARVIS_LIVE_GEMINI") == "1"
    private val key = System.getenv("GEMINI_API_KEY").orEmpty()
    private val llmCalls = mutableListOf<String>()

    private val fake = Interceptor { chain ->
        val req = chain.request()
        val host = req.url.host
        if (host == "generativelanguage.googleapis.com") {
            if (req.url.encodedPath.endsWith("/chat/completions")) {
                val sent = Buffer().also { req.body!!.writeTo(it) }.readUtf8()
                val model = Regex("\"model\":\"([^\"]+)\"").find(sent)?.groupValues?.get(1)
                val choice = Regex("\"tool_choice\":(\\{[^}]*\\}\\}|\"[a-z]+\")").find(sent)?.groupValues?.get(1) ?: "-"
                val effort = Regex("\"reasoning_effort\":\"([a-z]+)\"").find(sent)?.groupValues?.get(1) ?: "-"
                val at = System.currentTimeMillis()
                println("→ $model choice=$choice effort=$effort ${sent.length}B")
                val res = try {
                    chain.proceed(req)
                } catch (e: Exception) {
                    println("  ✗ $model ${e.javaClass.simpleName} หลัง ${System.currentTimeMillis() - at}ms")
                    throw e
                }
                println("  ← $model ${res.code} ใน ${System.currentTimeMillis() - at}ms")
                llmCalls += "$model $choice → ${res.code} ${(System.currentTimeMillis() - at) / 1000}s"
                return@Interceptor res
            }
            return@Interceptor chain.proceed(req)
        }
        val sent = req.body?.let { b -> Buffer().also { b.writeTo(it) }.readUtf8() }.orEmpty()
        val body = when {
            host == "api.tavily.com" && "include_domains" in sent -> VIDEOS
            host == "api.tavily.com" -> SEARCH
            host == "finnhub.io" && req.url.encodedPath.endsWith("/quote") -> """{"c":512.3,"d":-6.2,"dp":-1.2,"h":518,"l":509,"o":517,"pc":518.5,"t":1794850000}"""
            host == "finnhub.io" -> "[]"
            else -> "{}"
        }
        Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(200).message("ok")
            .body(body.toResponseBody("application/json".toMediaType())).build()
    }

    private val http = Http(OkHttpClient.Builder().addInterceptor(fake).readTimeout(120, TimeUnit.SECONDS).callTimeout(150, TimeUnit.SECONDS).build())

    private var timerSet: Int? = null
    private val timer = object : Tool {
        override val name = "set_timer"
        override val description = "Start a countdown timer in the Clock app."
        override val parameters = Schema.obj("seconds" to Schema.int("Duration in seconds", 1, 86_400), required = listOf("seconds"))
        override val device = true
        override fun traceLabel(args: JsonObject) = "ตั้งเวลา" to ""
        override suspend fun run(args: JsonObject, ctx: ResearchContext): String {
            timerSet = args.int("seconds")
            return "Timer set for $timerSet seconds"
        }
    }

    private fun agent(model: String, fallbacks: List<String>): Agent {
        val tavily = TavilyClient(http) { "fake" }
        val finnhub = FinnhubClient(http) { "fake" }
        val market = MarketService(finnhub, TwelveDataClient(http) { "" })
        val llm = OpenAiCompatClient(http) { LlmConfig(ModelCatalog.GEMINI_BASE, key, model, fallbacks) }
        return Agent(llm, { listOf(WebSearchTool(tavily), QuotesTool(market), FindVideosTool(tavily), timer) }, market)
    }

    @Test
    fun geminiFreeTierRunsJarvis() = runBlocking {
        if (!live) return@runBlocking
        val check = com.smott.jarvis.core.keys.KeyChecker(http).check(com.smott.jarvis.core.keys.KeyService.GEMINI, key)
        println("ตรวจคีย์: $check")
        assertTrue(check.ok)
        val models = ModelCatalog.geminiModels(http, key)
        val order = ModelCatalog.geminiCandidates(models)
        println("ลำดับรุ่น: $order (จาก ${models.size} รุ่น)")
        val a = agent(order.first(), order.drop(1))

        val t1 = System.currentTimeMillis()
        val r1 = a.run("สรุปสถานะตลาดแว่น VR ตอนนี้ให้หน่อย มีคลิปด้วยยิ่งดี", emptyList()) {}
        val b1 = r1.briefing
        println("1) ${(System.currentTimeMillis() - t1) / 1000}s · ${b1.title} | ${b1.overview?.headline}")
        println("   stats=${b1.stats.map { it.value }} sections=${b1.analysis.map { it.heading }} videos=${b1.videos.map { it.sourceId }} figures=${b1.figures.map { it.title }}")
        println("   spoken=${b1.spoken}")
        println("   sources=${r1.newSources.map { "${it.id}:${it.kind}" }} cited=${b1.citedIds()}")
        println("   tool_choice ที่ส่ง: $llmCalls")
        assertTrue(b1.title.isNotBlank() && b1.overview != null && b1.analysis.isNotEmpty(), "ต้องได้คำตอบเต็ม ไม่ใช่คำตอบสำรอง")
        assertTrue(b1.citedIds().all { id -> r1.newSources.any { it.id == id } })
        assertTrue(r1.newSources.any { it.kind == SourceKind.VIDEO }, "ควรเรียก find_videos")

        llmCalls.clear()
        val started = System.currentTimeMillis()
        val r2 = try {
            a.run("ตั้งเวลา 25 นาที", emptyList()) {}
        } finally {
            println("2) ${(System.currentTimeMillis() - started) / 1000}s · เรียก: $llmCalls")
        }
        println("   timer=$timerSet | ${r2.briefing.spoken}")
        assertTrue(timerSet == 1500, "ต้องตั้งเวลา 1500 วินาที")
    }

    private companion object {
        val SEARCH = """{"images":[{"url":"https://img.example.com/q3.jpg","description":"Meta Quest 3 headset"}],"results":[
          {"title":"VR headset shipments fell 12% in 2025, Meta keeps 75% share","url":"https://example.com/idc-vr","content":"Global VR headset shipments fell 12% year over year to 6.2 million units in 2025, according to IDC. Meta held about 75% of the market with Quest 3 and Quest 3S. Shipments were 9.6M in 2022, 7.5M in 2023, 6.9M in 2024.","published_date":"Mon, 10 Nov 2026 10:00:00 GMT"},
          {"title":"Quest 3S price cut to ${'$'}249","url":"https://example.com/quest3s","content":"Meta cut the Quest 3S price to ${'$'}249 for the holidays. Quest 3 stays at ${'$'}499.","published_date":"Wed, 12 Nov 2026 08:00:00 GMT"},
          {"title":"Apple Vision Pro sales remain small","url":"https://example.com/avp","content":"Analysts estimate Apple sold under 500,000 Vision Pro units in its first year; price remains the main barrier.","published_date":"Fri, 07 Nov 2026 08:00:00 GMT"}
        ]}"""
        val VIDEOS = """{"results":[
          {"title":"Quest 3S review: best cheap VR headset?","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","content":"A full review of the Meta Quest 3S."},
          {"title":"Vision Pro one year later","url":"https://youtu.be/abcdefghijk","content":"Is the Apple Vision Pro worth it a year later?"}
        ],"images":[]}"""
    }
}
