package com.smott.jarvis.core.providers

import com.smott.jarvis.core.JarvisJson
import com.smott.jarvis.core.model.Quote
import com.smott.jarvis.core.net.Http
import com.smott.jarvis.core.net.RateLimiter
import com.smott.jarvis.core.net.withRetry
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.time.LocalDate

/** Finnhub — ราคาหุ้นสหรัฐฯ แบบเรียลไทม์ + ข่าวตลาด/ข่าวบริษัท (ฟรี 60 ครั้ง/นาที) */
class FinnhubClient(private val http: Http, private val apiKey: () -> String) {

    private val limiter = RateLimiter(permits = 50, windowMs = 60_000)

    val available: Boolean get() = apiKey().isNotBlank()

    suspend fun quote(symbol: String): FinnhubQuote =
        get("quote", mapOf("symbol" to symbol), FinnhubQuote.serializer())

    suspend fun companyNews(symbol: String, from: LocalDate, to: LocalDate): List<FinnhubNews> =
        get(
            "company-news",
            mapOf("symbol" to symbol, "from" to from.toString(), "to" to to.toString()),
            ListSerializer(FinnhubNews.serializer()),
        )

    suspend fun marketNews(category: String = "general"): List<FinnhubNews> =
        get("news", mapOf("category" to category), ListSerializer(FinnhubNews.serializer()))

    private suspend fun <T> get(path: String, params: Map<String, String>, serializer: KSerializer<T>): T {
        limiter.acquire()
        val url = "https://finnhub.io/api/v1/".toHttpUrl().newBuilder()
            .addPathSegments(path)
            .apply { params.forEach { (k, v) -> addQueryParameter(k, v) } }
            .build()
        val text = withRetry(1) { http.get(url, mapOf("X-Finnhub-Token" to apiKey())) }
        return JarvisJson.decodeFromString(serializer, text)
    }
}

@Serializable
data class FinnhubQuote(
    val c: Double? = null,
    val d: Double? = null,
    val dp: Double? = null,
    val h: Double? = null,
    val l: Double? = null,
    val o: Double? = null,
    val pc: Double? = null,
    val t: Long? = null,
) {
    /** Finnhub ตอบ c = 0 เมื่อไม่รู้จักสัญลักษณ์ */
    fun toQuote(symbol: String): Quote? {
        val price = c ?: return null
        val prev = pc ?: 0.0
        if (price == 0.0 && prev == 0.0) return null
        val change = d ?: (price - prev)
        val pct = dp ?: if (prev != 0.0) change / prev * 100.0 else 0.0
        return Quote(
            symbol = symbol,
            price = price,
            change = change,
            changePct = pct,
            high = h ?: price,
            low = l ?: price,
            open = o ?: price,
            prevClose = prev,
            time = (t ?: 0L) * 1000L,
        )
    }
}

@Serializable
data class FinnhubNews(
    val category: String = "",
    val datetime: Long = 0,
    val headline: String = "",
    val id: Long = 0,
    val image: String = "",
    val related: String = "",
    val source: String = "",
    val summary: String = "",
    val url: String = "",
)
