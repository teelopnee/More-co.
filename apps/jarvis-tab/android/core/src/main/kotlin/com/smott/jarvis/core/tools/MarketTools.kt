package com.smott.jarvis.core.tools

import com.smott.jarvis.core.agent.ResearchContext
import com.smott.jarvis.core.market.MarketService
import com.smott.jarvis.core.market.isValidSymbol
import com.smott.jarvis.core.market.normalizeSymbol
import com.smott.jarvis.core.model.ChartRange
import com.smott.jarvis.core.model.Source
import com.smott.jarvis.core.model.SourceKind
import com.smott.jarvis.core.net.resultOf
import com.smott.jarvis.core.providers.FinnhubClient
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.time.LocalDate
import java.time.ZoneId

internal fun ResearchContext.finnhubSource(): Source = register(
    kind = SourceKind.DATA,
    title = "Finnhub — ราคาหุ้นสหรัฐฯ",
    url = "https://finnhub.io",
    publisher = "Finnhub",
    publishedAt = System.currentTimeMillis(),
)

internal fun ResearchContext.twelveDataSource(): Source = register(
    kind = SourceKind.DATA,
    title = "Twelve Data — ราคาย้อนหลัง",
    url = "https://twelvedata.com",
    publisher = "Twelve Data",
    publishedAt = System.currentTimeMillis(),
)

/** ราคาล่าสุด — ตัวเลขทุกตัวบนจอมาจากเครื่องมือนี้ ไม่ใช่จากโมเดล */
class QuotesTool(private val market: MarketService) : Tool {
    override val name = "get_quotes"
    override val description =
        "Latest quotes for US stocks/ETFs: price, change and % change vs previous close, day high/low. " +
            "Use tickers like QQQ, XLK, SMH, SPY, NVDA. Index codes like ^IXIC are not supported — use ETFs. Max 12."
    override val parameters = Schema.obj(
        "symbols" to Schema.arr(Schema.str("Ticker"), "Tickers", maxItems = 12),
        required = listOf("symbols"),
    )
    override val available: Boolean get() = market.quotesAvailable
    override val requires = "Finnhub API key"

    override fun traceLabel(args: JsonObject) = "ดึงราคา" to args.strList("symbols").joinToString(" ")

    override suspend fun run(args: JsonObject, ctx: ResearchContext): String {
        val symbols = args.strList("symbols").map(::normalizeSymbol).filter(::isValidSymbol).distinct().take(12)
        if (symbols.isEmpty()) return "ERROR: symbols are required"
        val results = market.quotes(symbols)
        val source = ctx.finnhubSource()
        val ok = results.values.mapNotNull { it.getOrNull() }
        ok.forEach { ctx.putQuote(it) }
        val missing = results.filterValues { it.isFailure }.keys
        return buildJsonObject {
            put("source_id", source.id)
            putJsonArray("quotes") {
                ok.forEach { q ->
                    addJsonObject {
                        put("symbol", q.symbol)
                        put("price", q.price.r2())
                        put("change", q.change.r2())
                        put("change_pct", q.changePct.r2())
                        put("day_high", q.high.r2())
                        put("day_low", q.low.r2())
                        put("prev_close", q.prevClose.r2())
                        if (q.time > 0) put("as_of", isoTime(q.time))
                    }
                }
            }
            if (missing.isNotEmpty()) putJsonArray("not_found") { missing.forEach { add(it) } }
        }.toString()
    }
}

/** ราคาย้อนหลัง — ส่งแค่สรุปให้โมเดล ส่วนข้อมูลเต็มเก็บไว้ให้แอปวาดกราฟ */
class PriceHistoryTool(private val market: MarketService) : Tool {
    override val name = "get_price_history"
    override val description =
        "Price history for up to 4 US tickers over a range (1D, 5D, 1M, 6M, 1Y). Returns start/end, % change, " +
            "high/low. The app draws the chart from this data. Free plan is slow (8 symbols/minute) — fetch only what you need."
    override val parameters = Schema.obj(
        "symbols" to Schema.arr(Schema.str("Ticker"), "Tickers", maxItems = 4),
        "range" to Schema.str("Time range", ChartRange.entries.map { it.label }),
        required = listOf("symbols", "range"),
    )
    override val available: Boolean get() = market.historyAvailable
    override val requires = "Twelve Data API key"

    override fun traceLabel(args: JsonObject) =
        "ดึงกราฟ" to "${args.strList("symbols").joinToString(" ")} · ${args.str("range") ?: "1M"}"

    override suspend fun run(args: JsonObject, ctx: ResearchContext): String {
        val symbols = args.strList("symbols").map(::normalizeSymbol).filter(::isValidSymbol).distinct().take(4)
        if (symbols.isEmpty()) return "ERROR: symbols are required"
        val range = ChartRange.parse(args.str("range"))
        val results = coroutineScope {
            symbols.map { s -> async { s to resultOf { market.history(s, range) } } }.awaitAll()
        }
        val source = ctx.twelveDataSource()
        return buildJsonObject {
            put("source_id", source.id)
            put("range", range.label)
            putJsonArray("series") {
                results.forEach { (symbol, result) ->
                    val series = result.getOrNull()
                    if (series == null) {
                        addJsonObject { put("symbol", symbol); put("error", result.exceptionOrNull()?.message ?: "failed") }
                        return@forEach
                    }
                    ctx.putSeries(series)
                    val first = series.points.first()
                    val last = series.points.last()
                    addJsonObject {
                        put("symbol", symbol)
                        put("from", isoTime(first.t))
                        put("to", isoTime(last.t))
                        put("start", first.close.r2())
                        put("end", last.close.r2())
                        put("change_pct", ((last.close / first.close - 1) * 100).r2())
                        put("high", series.points.maxOf { it.close }.r2())
                        put("low", series.points.minOf { it.close }.r2())
                        put("points", series.points.size)
                    }
                }
            }
        }.toString()
    }
}

/** ข่าวตลาด/ข่าวบริษัทจาก Finnhub (มีรูปปกข่าวให้ด้วย) */
class MarketNewsTool(private val finnhub: FinnhubClient) : Tool {
    override val name = "get_market_news"
    override val description =
        "Latest financial news from Finnhub. With symbol: company news for that US ticker. " +
            "Without symbol: general market news. Returns source ids, headline, publisher, time and summary."
    override val parameters = Schema.obj(
        "symbol" to Schema.str("Optional US ticker for company news"),
        "days" to Schema.int("Look-back days for company news, default 2", 1, 7),
    )
    override val available: Boolean get() = finnhub.available
    override val requires = "Finnhub API key"

    override fun traceLabel(args: JsonObject) = "ดึงข่าว" to (args.str("symbol") ?: "ตลาดโดยรวม")

    override suspend fun run(args: JsonObject, ctx: ResearchContext): String {
        val symbol = args.str("symbol")?.let(::normalizeSymbol)?.takeIf(::isValidSymbol)
        val items = if (symbol != null) {
            val days = (args.int("days") ?: 2).coerceIn(1, 7).toLong()
            val today = LocalDate.now(ZoneId.of("America/New_York"))
            finnhub.companyNews(symbol, today.minusDays(days), today)
        } else {
            finnhub.marketNews("general")
        }
        val picked = items
            .filter { it.headline.isNotBlank() && it.url.startsWith("http") }
            .sortedByDescending { it.datetime }
            .distinctBy { it.headline.lowercase() }
            .take(8)
        if (picked.isEmpty()) return "No news found"

        return buildJsonArray {
            picked.forEach { n ->
                val src = ctx.register(
                    kind = SourceKind.NEWS,
                    title = n.headline,
                    url = n.url,
                    publisher = n.source.ifBlank { hostOf(n.url) },
                    publishedAt = n.datetime.takeIf { it > 0 }?.times(1000),
                    snippet = n.summary.take(400),
                    imageUrl = n.image.takeIf { it.startsWith("http") },
                )
                addJsonObject {
                    put("id", src.id)
                    put("title", n.headline)
                    put("publisher", src.publisher)
                    src.publishedAt?.let { put("date", isoTime(it)) }
                    put("summary", n.summary.take(300))
                }
            }
        }.toString()
    }
}
