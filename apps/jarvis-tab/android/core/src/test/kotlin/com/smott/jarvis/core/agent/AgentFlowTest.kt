package com.smott.jarvis.core.agent

import com.smott.jarvis.core.llm.LlmConfig
import com.smott.jarvis.core.llm.OpenAiCompatClient
import com.smott.jarvis.core.market.MarketService
import com.smott.jarvis.core.model.Turn
import com.smott.jarvis.core.model.TurnStatus
import com.smott.jarvis.core.net.Http
import com.smott.jarvis.core.net.HttpError
import com.smott.jarvis.core.providers.FinnhubClient
import com.smott.jarvis.core.providers.PageReader
import com.smott.jarvis.core.providers.TavilyClient
import com.smott.jarvis.core.providers.TwelveDataClient
import com.smott.jarvis.core.tools.MarketNewsTool
import com.smott.jarvis.core.tools.PriceHistoryTool
import com.smott.jarvis.core.tools.QuotesTool
import com.smott.jarvis.core.tools.ReadPageTool
import com.smott.jarvis.core.tools.WebSearchTool
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * ลองใช้ "สมอง" ของ Jarvis ทั้งวงจรบนคอม: ทุกคลาสเป็นของจริง (Agent, ไคลเอนต์ LLM, Tavily, Finnhub,
 * Twelve Data, การตรวจที่มา) มีแค่เครือข่ายที่เปลี่ยนเป็นคำตอบสำเร็จรูป (ไม่มีคีย์จริงในเครื่องนี้)
 */
class AgentFlowTest {

    private class Net : Interceptor {
        val llmReplies = ArrayDeque<Pair<Int, String>>()
        val llmRequests = mutableListOf<JsonObject>()
        val hits = mutableListOf<String>()

        override fun intercept(chain: Interceptor.Chain): Response {
            val req = chain.request()
            val url = req.url
            val path = url.encodedPath
            hits += "${url.host}$path" + (url.queryParameter("symbol")?.let { "?symbol=$it" } ?: "")
            val (code, body) = when {
                url.host == "openrouter.ai" -> {
                    val buf = Buffer().also { req.body!!.writeTo(it) }
                    llmRequests += Json.parseToJsonElement(buf.readUtf8()).jsonObject
                    llmReplies.removeFirst()
                }
                url.host == "api.tavily.com" && path.endsWith("/search") -> {
                    val sent = Buffer().also { req.body!!.writeTo(it) }.readUtf8()
                    200 to if ("include_domains" in sent) TAVILY_VIDEOS else TAVILY
                }
                url.host == "finnhub.io" && path.endsWith("/quote") -> 200 to quote(url.queryParameter("symbol")!!)
                url.host == "finnhub.io" && path.endsWith("/news") -> 200 to FINNHUB_NEWS
                url.host == "finnhub.io" && path.endsWith("/company-news") -> 200 to FINNHUB_NEWS
                url.host == "api.twelvedata.com" -> 200 to series(url.queryParameter("symbol")!!, url.queryParameter("interval")!!)
                else -> 404 to "not found"
            }
            return Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(code).message("x")
                .body(body.toResponseBody("application/json".toMediaType())).build()
        }
    }

    private fun build(net: Net, keys: Boolean = true, extra: List<com.smott.jarvis.core.tools.Tool> = emptyList()): Agent {
        val http = Http(OkHttpClient.Builder().addInterceptor(net).build())
        val k = if (keys) "test-key" else ""
        val tavily = TavilyClient(http) { k }
        val finnhub = FinnhubClient(http) { k }
        val twelve = TwelveDataClient(http) { k }
        val market = MarketService(finnhub, twelve)
        val llm = OpenAiCompatClient(http) { LlmConfig("https://openrouter.ai/api/v1", "or-key", "~anthropic/claude-sonnet-latest") }
        val tools = listOf(
            WebSearchTool(tavily), ReadPageTool(tavily, PageReader(http)), QuotesTool(market), PriceHistoryTool(market),
            MarketNewsTool(finnhub), com.smott.jarvis.core.tools.FindVideosTool(tavily),
        ) + extra
        return Agent(llm, { tools }, market)
    }

    @Test
    fun techMarketThenFollowUp() = runBlocking {
        val net = Net()
        val agent = build(net)

        // รอบ 1: โมเดลวางแผนแล้วเรียกเครื่องมือ 4 ตัวพร้อมกัน
        net.llmReplies += 200 to toolCalls(
            call("c1", "web_search", """{"query":"tech stocks today","topic":"news","time_range":"day"}"""),
            call("c2", "get_quotes", """{"symbols":["QQQ","nvda","${'$'}XLK"]}"""),
            call("c3", "get_price_history", """{"symbols":["QQQ"],"range":"5D"}"""),
            call("c4", "get_market_news", "{}"),
        )
        // รอบ 2: จัดหน้าสรุป — ใส่ที่มาปลอม S99, sources เป็นข้อความ, กราฟขอ SMH ที่ยังไม่ได้ดึง, watchlist มี AMD ที่ยังไม่ได้ดึง
        net.llmReplies += 200 to toolCalls(
            call("c5", "present_briefing", BRIEFING),
        )

        val traces = mutableListOf<String>()
        val r = agent.run("วิเคราะห์ตลาดหุ้นเทควันนี้ให้หน่อย", emptyList()) { steps ->
            traces += steps.joinToString(" | ") { (if (it.failed) "✗ " else if (it.done) "✓ " else "… ") + it.label + (if (it.detail.isNotBlank()) ": " + it.detail else "") }
        }
        println("=== ขั้นตอนบนจอ (สุดท้าย) ===\n" + traces.last().replace(" | ", "\n"))
        println("=== ที่มา ===")
        r.newSources.forEach { println("${it.id} ${it.kind} ${it.title} (${it.publisher})") }
        val b = r.briefing
        println("=== คำตอบ ===")
        println("หัวข้อ: ${b.title}\nพูด: ${b.spoken}\nภาพรวม: ${b.overview?.headline} [${b.overview?.mood}]")
        b.overview?.points?.forEach { println("  - ${it.text} ${it.sources}") }
        println("กราฟ: ${b.chart?.symbols} ${b.chart?.range}")
        println("ราคา: " + b.watchlist.joinToString { s -> r.quotes.first { it.symbol == s }.let { "$s ${it.price} (${it.changePct}%)" } })
        println("ข่าว: ${b.news.map { it.sourceId }}")
        b.factors.forEach { println("ปัจจัย ${it.effect}: ${it.name} ${it.sources}") }
        b.analysis.forEach { println("วิเคราะห์: ${it.heading} ${it.sources}") }
        println("ถามต่อ: ${b.followUps}")
        println("เรียกเครือข่าย: ${net.hits}")

        val allCited = b.citedIds()
        assertTrue("S99" !in allCited, "ที่มาปลอม S99 ต้องถูกตัด")
        assertTrue(allCited.all { id -> r.newSources.any { it.id == id } })
        assertEquals(listOf("QQQ", "SMH"), b.chart?.symbols, "SMH ต้องถูกดึงกราฟเองแม้โมเดลไม่ได้ดึง")
        assertTrue("AMD" in b.watchlist && r.quotes.any { it.symbol == "AMD" }, "AMD ต้องถูกดึงราคาเอง")
        assertTrue(r.quotes.any { it.symbol == "XLK" }, "\$XLK ต้องถูกแปลงเป็น XLK")

        // คำขอที่ส่งไป OpenRouter ถูกรูปแบบ
        val first = net.llmRequests.first()
        assertEquals("~anthropic/claude-sonnet-latest", first["model"]!!.jsonPrimitive.content)
        val toolNames = first["tools"]!!.jsonArray.map { it.jsonObject["function"]!!.jsonObject["name"]!!.jsonPrimitive.content }
        println("เครื่องมือที่ส่งให้โมเดล: $toolNames")
        val second = net.llmRequests[1]["messages"]!!.jsonArray
        assertEquals(listOf("system", "user", "assistant", "tool", "tool", "tool", "tool"), second.map { it.jsonObject["role"]!!.jsonPrimitive.content })

        // รอบ 2: ถามต่อ — id ที่มาต้องต่อจากเดิม และ prompt ต้องมีที่มาเดิม
        val turn1 = Turn("t1", "วิเคราะห์ตลาดหุ้นเทควันนี้ให้หน่อย", 0, TurnStatus.DONE, briefing = b, sources = r.newSources, quotes = r.quotes, series = r.series)
        net.llmReplies += 200 to toolCalls(call("d1", "get_market_news", """{"symbol":"NVDA","days":2}"""))
        net.llmReplies += 200 to toolCalls(call("d2", "present_briefing", """{"title":"ทำไม NVDA ลง","spoken":"NVDA ลงเพราะ...","overview":{"headline":"แรงขายทำกำไร","points":[{"text":"อ้างข่าวเดิม","sources":["S1"]}]}}"""))
        val r2 = agent.run("แล้ว NVDA ล่ะ ทำไมลง", listOf(turn1)) {}
        val sys = net.llmRequests[2]["messages"]!!.jsonArray.first().jsonObject["content"]!!.jsonPrimitive.content
        assertTrue("Sources from earlier turns" in sys && "S1 |" in sys)
        val maxOld = r.newSources.maxOf { it.id.drop(1).toInt() }
        println("ถามต่อ: ที่มาใหม่ ${r2.newSources.map { it.id }} (ที่มาเดิมถึง S$maxOld) · คำตอบอ้าง ${r2.briefing.citedIds()}")
        assertTrue(r2.newSources.all { it.id.drop(1).toInt() > maxOld })
        assertEquals(setOf("S1"), r2.briefing.overview!!.points.flatMap { it.sources }.toSet())
    }

    @Test
    fun plainTextAnswerAndBrokenJson() = runBlocking {
        val net = Net()
        val agent = build(net)
        net.llmReplies += 200 to text("สวัสดีครับ ผมช่วยอะไรได้บ้าง")
        // คำตอบยาวจนโดนตัดที่ max_tokens: JSON ขาดท้ายทุกครั้ง
        repeat(20) { net.llmReplies += 200 to toolCalls(call("x$it", "present_briefing", """{"title":"ตลาด","spoken":"ยาวมาก","overview":{"headline":"ตัดกลาง""")) }
        val r = agent.run("สวัสดี", emptyList()) {}
        println("ตอบเป็นข้อความ + JSON ขาดท้าย → เรียกโมเดล ${net.llmRequests.size} ครั้ง → ${r.briefing.overview?.headline}")
        assertEquals("สวัสดีครับ ผมช่วยอะไรได้บ้าง", r.briefing.overview?.headline)
        assertEquals(3, net.llmRequests.size, "ข้อความ 1 ครั้ง + จัดหน้าเสีย 2 ครั้ง แล้วต้องหยุด ไม่เรียกซ้ำจนครบ 10")
    }

    @Test
    fun researchBlocksVideosImagesStatsFigures() = runBlocking {
        val net = Net()
        val agent = build(net)
        net.llmReplies += 200 to toolCalls(call("v", "find_videos", """{"query":"quest 3 review"}"""))
        net.llmReplies += 200 to toolCalls(call("w", "web_search", """{"query":"vr headset shipments 2026"}"""))
        net.llmReplies += 200 to toolCalls(call("b", "present_briefing", BLOCKS))
        val progress = mutableListOf<Int>()
        val r = agent.run("สรุปตลาด VR ให้หน่อย", emptyList(), onProgress = { sources, images -> progress += sources.size + images.size }) {}
        val b = r.briefing
        println("คลิป: ${r.newSources.filter { it.videoId != null }.map { "${it.id} ${it.platform} ${it.videoId}" }}")
        println("ภาพ: ${r.images.map { it.url }}")
        println("แผง: videos=${b.videos.map { it.sourceId }} stats=${b.stats.map { it.value }} figures=${b.figures.map { it.title }}")
        assertEquals(listOf("youtube", "youtube", "tiktok"), r.newSources.filter { it.videoId != null }.map { it.platform })
        assertEquals(listOf("S1"), b.videos.map { it.sourceId }, "เหลือเฉพาะคลิปจริงที่มีอยู่")
        assertEquals(listOf("≈20M"), b.stats.map { it.value }, "ตัวเลขที่ไม่มีที่มาต้องถูกตัด")
        assertEquals(listOf("ยอดส่งมอบ VR"), b.figures.map { it.title }, "กราฟที่ข้อมูลไม่ครบ/ไม่มีที่มาต้องถูกตัด")
        assertEquals(2, r.images.size)
        assertTrue(progress.isNotEmpty() && progress.last() >= progress.first(), "หน้าจอได้รับความคืบหน้าระหว่างค้น")
    }

    @Test
    fun webContentCannotTriggerDeviceCommands() = runBlocking {
        val net = Net()
        var opened = false
        val device = object : com.smott.jarvis.core.tools.Tool {
            override val name = "open_url"
            override val description = "Open a link"
            override val parameters = com.smott.jarvis.core.tools.Schema.obj("url" to com.smott.jarvis.core.tools.Schema.str("url"))
            override val device = true
            override fun traceLabel(args: JsonObject) = "เปิดลิงก์" to ""
            override suspend fun run(args: JsonObject, ctx: ResearchContext): String { opened = true; return "Opened" }
        }
        val agent = build(net, extra = listOf(device))
        net.llmReplies += 200 to toolCalls(call("w", "web_search", """{"query":"news"}"""))
        // สมมติว่าหน้าเว็บหลอกให้โมเดลเปิดลิงก์
        net.llmReplies += 200 to toolCalls(call("o", "open_url", """{"url":"https://evil.example"}"""))
        net.llmReplies += 200 to toolCalls(call("b", "present_briefing", """{"title":"t","spoken":"s","overview":"ok"}"""))
        agent.run("ข่าววันนี้", emptyList()) {}
        val toolsAtStep2 = net.llmRequests[1]["tools"]!!.jsonArray.map { it.jsonObject["function"]!!.jsonObject["name"]!!.jsonPrimitive.content }
        println("เครื่องมือหลังอ่านเว็บ: $toolsAtStep2")
        assertTrue(!opened, "ต้องไม่เปิดลิงก์ตามคำสั่งที่มาหลังอ่านเว็บ")
        assertTrue("open_url" !in toolsAtStep2)
    }

    @Test
    fun noKeysAndBadKey() = runBlocking {
        val net = Net()
        val agent = build(net, keys = false)
        net.llmReplies += 200 to toolCalls(call("z", "present_briefing", """{"title":"x","spoken":"y","overview":"ค้นไม่ได้"}"""))
        val r = agent.run("ข่าววันนี้", emptyList()) {}
        val sys = net.llmRequests.first()["messages"]!!.jsonArray.first().jsonObject["content"]!!.jsonPrimitive.content
        println("ไม่มีคีย์: " + sys.lines().first { it.startsWith("Not available") })
        assertTrue(net.llmRequests.first()["tools"]!!.jsonArray.size == 2) // read_page + present_briefing
        assertEquals("ค้นไม่ได้", r.briefing.overview?.headline)

        net.llmReplies += 401 to """{"error":{"message":"No auth credentials found","code":401}}"""
        val e = assertFailsWith<HttpError> { agent.run("x", emptyList()) {} }
        println("คีย์ผิด: HTTP ${e.code} จาก ${e.host}")
    }

    companion object {
        fun call(id: String, name: String, args: String) =
            """{"id":"$id","type":"function","function":{"name":"$name","arguments":${kotlinx.serialization.json.JsonPrimitive(args)}}}"""

        fun toolCalls(vararg calls: String) =
            """{"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[${calls.joinToString(",")}]},"finish_reason":"tool_calls"}]}"""

        fun text(t: String) = """{"choices":[{"message":{"role":"assistant","content":"$t"},"finish_reason":"stop"}]}"""

        val TAVILY_VIDEOS = """{"results":[
            {"title":"Quest 3 review","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","content":"A review"},
            {"title":"Quest 3S short","url":"https://youtu.be/abcdefghijk?t=3","content":"Short"},
            {"title":"VR on TikTok","url":"https://www.tiktok.com/@vrfan/video/7212345678901234567","content":"clip"},
            {"title":"Channel page","url":"https://www.youtube.com/@metaquest","content":"not a video"}
        ],"images":[]}"""

        val TAVILY = """{"images":[{"url":"https://img.example.com/q3.jpg","description":"Quest 3 headset"},"https://img.example.com/vp.jpg","http://insecure.example.com/x.jpg"],"results":[
            {"title":"Nasdaq slips as chip stocks retreat","url":"https://example.com/a","content":"The Nasdaq fell 1.2% as Nvidia and other chipmakers slid...","published_date":"Mon, 16 Nov 2026 14:00:00 GMT"},
            {"title":"Tech earnings week ahead","url":"https://example.org/b","content":"Investors await results from...","published_date":"2026-11-15"}
        ]}"""

        val FINNHUB_NEWS = """[
            {"category":"top news","datetime":1794835200,"headline":"Fed officials signal patience on rates","id":1,"image":"https://img.example.com/1.jpg","source":"Reuters","summary":"...","url":"https://example.net/fed"},
            {"category":"top news","datetime":1794831600,"headline":"Nvidia shares fall ahead of earnings","id":2,"image":"","source":"CNBC","summary":"...","url":"https://example.net/nvda"}
        ]"""

        fun quote(s: String): String {
            val p = mapOf("QQQ" to 512.3, "NVDA" to 141.2, "XLK" to 231.0, "AMD" to 152.7)[s] ?: 0.0
            return """{"c":$p,"d":-3.1,"dp":-1.2,"h":${p + 2},"l":${p - 3},"o":${p + 1},"pc":${p + 3.1},"t":1794850000}"""
        }

        fun series(s: String, interval: String): String {
            val days = (0 until 10).map { LocalDate.of(2026, 11, 3).plusDays(it.toLong()) }
            val values = days.mapIndexed { i, d ->
                val time = if (interval == "1day") "$d" else "$d 1${i % 6}:30:00"
                """{"datetime":"$time","open":"1","high":"1","low":"1","close":"${100 + i * (if (s == "SMH") -1 else 1)}","volume":"1"}"""
            }.reversed()
            return """{"meta":{"symbol":"$s","interval":"$interval","currency":"USD","exchange_timezone":"America/New_York"},"values":[${values.joinToString(",")}],"status":"ok"}"""
        }

        val BLOCKS = """{
          "title":"ตลาด VR","spoken":"สรุปตลาด VR","overview":{"headline":"VR ทรงตัว","points":[{"text":"ยอดส่งมอบลดลง","sources":["S4"]}]},
          "videos":[{"sourceId":"S1","why":"รีวิว"},{"sourceId":"S4","why":"ไม่ใช่คลิป"},{"sourceId":"S9","why":"ไม่มีจริง"}],
          "stats":[{"value":"≈20M","label":"ผู้ใช้ Quest","sources":["S4"]},{"value":"99%","label":"ไม่มีที่มา","sources":[]},{"value":"1B","label":"ที่มาปลอม","sources":["S99"]}],
          "figures":[
            {"title":"ยอดส่งมอบ VR","unit":"ล้านเครื่อง","labels":["2024","2025","2026"],"values":[9.6,7.1,6.2],"sources":["S4"]},
            {"title":"ข้อมูลไม่ครบ","labels":["a","b"],"values":[1],"sources":["S4"]},
            {"title":"ไม่มีที่มา","labels":["a","b"],"values":[1,2],"sources":[]}
          ]
        }"""

        val BRIEFING = """{
          "title":"ตลาดหุ้นเทควันนี้",
          "spoken":"หุ้นเทคย่อตัววันนี้ นำโดยกลุ่มชิป",
          "overview":{"headline":"Nasdaq ย่อตัว กลุ่มชิปกดดัน","mood":"BEARISH","points":[
             {"text":"Nasdaq ลง 1.2%","sources":"S1, S99"},
             {"text":"NVDA ลงก่อนงบ","sources":["S5"]}]},
          "chart":{"symbols":["QQQ","smh"],"range":"5D"},
          "watchlist":["QQQ","NVDA","AMD"],
          "news":[{"source_id":"S4","why":"ดอกเบี้ย"},{"sourceId":"S3","why":"ข้อมูลราคา ไม่ใช่ข่าว"},{"sourceId":"S42","why":"ปลอม"}],
          "factors":[{"name":"ดอกเบี้ย","effect":"mixed","detail":"Fed ยังรอ","sources":["S4"]}],
          "analysis":"ภาพรวมยังผันผวน",
          "followUps":["แล้ว NVDA ล่ะ ทำไมลง","ควรรอซื้อไหม",""]
        }"""
    }
}
