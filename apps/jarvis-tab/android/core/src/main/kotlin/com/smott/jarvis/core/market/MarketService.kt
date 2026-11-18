package com.smott.jarvis.core.market

import com.smott.jarvis.core.model.ChartRange
import com.smott.jarvis.core.model.PricePoint
import com.smott.jarvis.core.model.PriceSeries
import com.smott.jarvis.core.model.Quote
import com.smott.jarvis.core.net.resultOf
import com.smott.jarvis.core.providers.FinnhubClient
import com.smott.jarvis.core.providers.TwelveDataClient
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.concurrent.ConcurrentHashMap

/** จุดเดียวที่ดึงตัวเลขตลาด — มีแคชเพื่อประหยัดโควตาฟรี */
class MarketService(
    private val finnhub: FinnhubClient,
    private val twelve: TwelveDataClient,
) {
    val quotesAvailable: Boolean get() = finnhub.available
    val historyAvailable: Boolean get() = twelve.available

    private val quoteCache = ConcurrentHashMap<String, Pair<Long, Quote>>()
    private val seriesCache = ConcurrentHashMap<String, Pair<Long, PriceSeries>>()

    suspend fun quotes(symbols: List<String>): Map<String, Result<Quote>> = coroutineScope {
        symbols.map { s -> async { s to resultOf { quote(s) } } }.awaitAll().toMap()
    }

    suspend fun quote(symbol: String): Quote {
        val now = System.currentTimeMillis()
        quoteCache[symbol]?.let { (at, q) -> if (now - at < 30_000) return q }
        val q = finnhub.quote(symbol).toQuote(symbol)
            ?: throw NoSuchElementException("ไม่พบสัญลักษณ์ $symbol (Finnhub ฟรีรองรับหุ้น/ETF สหรัฐฯ)")
        quoteCache[symbol] = now to q
        return q
    }

    suspend fun history(symbol: String, range: ChartRange): PriceSeries {
        val key = "$symbol|${range.name}"
        val now = System.currentTimeMillis()
        seriesCache[key]?.let { (at, s) -> if (now - at < ttl(range)) return s }

        val (interval, size) = when (range) {
            ChartRange.D1 -> "5min" to 78
            ChartRange.D5 -> "30min" to 65
            ChartRange.M1 -> "1day" to 22
            ChartRange.M6 -> "1day" to 126
            ChartRange.Y1 -> "1day" to 252
        }
        val td = twelve.timeSeries(symbol, interval, size)
        val zone = runCatching { ZoneId.of(td.meta?.exchangeTimezone ?: NY) }.getOrElse { ZoneId.of(NY) }
        var points = td.values.mapNotNull { v ->
            val t = parseTime(v.datetime, zone) ?: return@mapNotNull null
            val close = v.close.toDoubleOrNull() ?: return@mapNotNull null
            PricePoint(t, close)
        }.sortedBy { it.t }

        if (range == ChartRange.D1 && points.size > 2) {
            // เก็บเฉพาะวันซื้อขายล่าสุด
            val lastDay = java.time.Instant.ofEpochMilli(points.last().t).atZone(zone).toLocalDate()
            val today = points.filter { java.time.Instant.ofEpochMilli(it.t).atZone(zone).toLocalDate() == lastDay }
            if (today.size >= 2) points = today
        }
        if (points.size < 2) throw IllegalStateException("ข้อมูลกราฟของ $symbol ไม่พอ")

        val series = PriceSeries(symbol, range, points, td.meta?.currency)
        seriesCache[key] = now to series
        return series
    }

    private fun ttl(range: ChartRange): Long = when (range) {
        ChartRange.D1 -> 2 * 60_000L
        ChartRange.D5 -> 10 * 60_000L
        else -> 60 * 60_000L
    }

    private fun parseTime(raw: String, zone: ZoneId): Long? = runCatching {
        val s = raw.trim()
        val zdt = if (s.length > 10) LocalDateTime.parse(s.replace(' ', 'T')).atZone(zone)
        else LocalDate.parse(s).atTime(16, 0).atZone(zone)
        zdt.toInstant().toEpochMilli()
    }.getOrNull()

    private companion object {
        const val NY = "America/New_York"
    }
}
