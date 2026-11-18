package com.smott.jarvis.core.providers

import com.smott.jarvis.core.JarvisJson
import com.smott.jarvis.core.net.Http
import com.smott.jarvis.core.net.RateLimiter
import com.smott.jarvis.core.net.withRetry
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.HttpUrl.Companion.toHttpUrl

/** Twelve Data — ราคาย้อนหลังสำหรับวาดกราฟ (แพ็กเกจฟรีจำกัด 8 เครดิต/นาที) */
class TwelveDataClient(private val http: Http, private val apiKey: () -> String) {

    private val limiter = RateLimiter(permits = 8, windowMs = 61_000)

    val available: Boolean get() = apiKey().isNotBlank()

    suspend fun timeSeries(symbol: String, interval: String, outputSize: Int): TdSeries {
        limiter.acquire()
        val url = "https://api.twelvedata.com/time_series".toHttpUrl().newBuilder()
            .addQueryParameter("symbol", symbol)
            .addQueryParameter("interval", interval)
            .addQueryParameter("outputsize", outputSize.toString())
            .addQueryParameter("apikey", apiKey())
            .build()
        val text = withRetry(1) { http.get(url) }
        val series = JarvisJson.decodeFromString(TdSeries.serializer(), text)
        if (series.status.equals("error", ignoreCase = true)) {
            throw TwelveDataException(series.code ?: 0, series.message ?: "unknown error")
        }
        return series
    }
}

class TwelveDataException(val code: Int, message: String) : Exception("Twelve Data ($code): $message")

@Serializable
data class TdSeries(
    val meta: TdMeta? = null,
    val values: List<TdValue> = emptyList(),
    val status: String = "",
    val code: Int? = null,
    val message: String? = null,
)

@Serializable
data class TdMeta(
    val symbol: String = "",
    val interval: String = "",
    val currency: String? = null,
    @SerialName("exchange_timezone") val exchangeTimezone: String? = null,
)

@Serializable
data class TdValue(
    val datetime: String = "",
    val close: String = "",
)
