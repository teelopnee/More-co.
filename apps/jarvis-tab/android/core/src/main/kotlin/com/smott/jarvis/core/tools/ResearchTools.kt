package com.smott.jarvis.core.tools

import com.smott.jarvis.core.agent.ResearchContext
import com.smott.jarvis.core.model.SourceKind
import com.smott.jarvis.core.providers.PageReader
import com.smott.jarvis.core.providers.TavilyClient
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** ค้นเว็บ/ข่าว ทุกผลลัพธ์ได้รหัสที่มา (S1, S2, …) เพื่อใช้อ้างอิง */
class WebSearchTool(private val tavily: TavilyClient) : Tool {
    override val name = "web_search"
    override val description =
        "Search the web. Returns results with a source id, title, publisher, date and snippet. " +
            "Use topic=news with time_range=day or week for recent news. Prefer several focused queries " +
            "(English usually covers global markets/tech better; Thai for Thai topics)."
    override val parameters = Schema.obj(
        "query" to Schema.str("Search query"),
        "topic" to Schema.str("general or news", listOf("general", "news")),
        "time_range" to Schema.str("Only results from this recent period", listOf("day", "week", "month", "year")),
        "max_results" to Schema.int("Number of results, default 5", 1, 8),
        required = listOf("query"),
    )
    override val available: Boolean get() = tavily.available
    override val requires = "Tavily API key"

    override fun traceLabel(args: JsonObject) = "ค้นเว็บ" to args.str("query").orEmpty()

    override suspend fun run(args: JsonObject, ctx: ResearchContext): String {
        val query = args.str("query") ?: return "ERROR: query is required"
        val topic = if (args.str("topic") == "news") "news" else "general"
        val timeRange = args.str("time_range")?.takeIf { it in setOf("day", "week", "month", "year") }
        val max = (args.int("max_results") ?: 5).coerceIn(1, 8)

        // ขอภาพประกอบมาด้วย (แอปใช้แสดงเป็นแผงภาพบนจอ ไม่ส่งให้โมเดล)
        val response = tavily.searchFull(query, topic, timeRange, max, includeImages = true)
        response.images.take(3).forEach { ctx.addImage(it.url, it.description, query) }
        val results = response.results.filter { it.url.startsWith("http") }
        if (results.isEmpty()) return "No results for: $query"

        return buildJsonArray {
            results.forEach { r ->
                val src = ctx.register(
                    kind = if (topic == "news") SourceKind.NEWS else SourceKind.WEB,
                    title = r.title.ifBlank { r.url },
                    url = r.url,
                    publishedAt = parseDateMillis(r.publishedDate),
                    snippet = r.content.take(400),
                )
                addJsonObject {
                    put("id", src.id)
                    put("title", src.title)
                    put("publisher", src.publisher)
                    src.publishedAt?.let { put("date", isoTime(it)) }
                    // ตัดให้สั้นพอ: ข้อความยิ่งยาว โมเดลยิ่งอ่านช้า
                    put("snippet", r.content.take(500))
                }
            }
        }.toString()
    }
}

/** อ่านเนื้อหาเต็มของหน้าที่สำคัญ (ใช้ Tavily extract ก่อน ถ้าไม่ได้ค่อยอ่านเอง) */
class ReadPageTool(private val tavily: TavilyClient, private val reader: PageReader) : Tool {
    override val name = "read_page"
    override val description =
        "Read the main text of a web page when the snippet is not enough. Pass source_id from earlier " +
            "results (preferred) or a url. Use only for the 1–3 most important pages."
    override val parameters = Schema.obj(
        "source_id" to Schema.str("Source id such as S3"),
        "url" to Schema.str("Full https url, only if there is no source id"),
    )

    override fun traceLabel(args: JsonObject): Pair<String, String> =
        "อ่านหน้าเว็บ" to (args.str("url")?.let(::hostOf) ?: args.str("source_id").orEmpty())

    override suspend fun run(args: JsonObject, ctx: ResearchContext): String {
        val known = args.str("source_id")?.let { ctx.get(it) }
        val url = known?.url ?: args.str("url") ?: return "ERROR: give source_id or url"
        if (!url.startsWith("http")) return "ERROR: invalid url"

        val extracted = if (tavily.available) {
            runCatching { tavily.extract(url) }.getOrNull()?.takeIf { it.length > 200 }
        } else null
        val page = if (extracted == null) reader.read(url) else null
        val content = extracted ?: page?.text.orEmpty()
        if (content.isBlank()) return "ERROR: page has no readable text (may need JavaScript or a login)"

        val source = known ?: ctx.register(
            kind = SourceKind.WEB,
            title = page?.title ?: url,
            url = url,
            imageUrl = page?.image,
        )
        return buildJsonObject {
            put("id", source.id)
            put("title", source.title)
            put("content", content.take(5_000))
        }.toString()
    }
}
