package com.smott.jarvis.core.providers

import com.smott.jarvis.core.JarvisJson
import com.smott.jarvis.core.net.Http
import com.smott.jarvis.core.net.withRetry
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Tavily — ค้นเว็บ/ข่าวที่ออกแบบมาให้ AI ใช้ (ฟรี 1,000 เครดิต/เดือน) */
class TavilyClient(private val http: Http, private val apiKey: () -> String) {

    val available: Boolean get() = apiKey().isNotBlank()

    suspend fun search(query: String, topic: String, timeRange: String?, maxResults: Int): List<TavilyResult> =
        searchFull(query, topic, timeRange, maxResults).results

    /** ค้นพร้อมตัวเลือกเพิ่ม: จำกัดโดเมน (ใช้หาคลิป) และขอรูปภาพประกอบ */
    suspend fun searchFull(
        query: String,
        topic: String = "general",
        timeRange: String? = null,
        maxResults: Int = 6,
        includeDomains: List<String>? = null,
        includeImages: Boolean = false,
    ): TavilySearchResponse {
        val body = JarvisJson.encodeToString(
            TavilySearchRequest.serializer(),
            TavilySearchRequest(
                query = query,
                topic = topic,
                maxResults = maxResults,
                timeRange = timeRange,
                includeDomains = includeDomains,
                includeImages = includeImages,
                includeImageDescriptions = includeImages,
            ),
        )
        val text = withRetry(1) { http.postJson("https://api.tavily.com/search", body, auth()) }
        return JarvisJson.decodeFromString(TavilySearchResponse.serializer(), text)
    }

    /** ดึงเนื้อหาหลักของหน้าเว็บ (ใช้เมื่อ snippet จากการค้นหาไม่พอ) */
    suspend fun extract(url: String): String? {
        val body = JarvisJson.encodeToString(TavilyExtractRequest.serializer(), TavilyExtractRequest(urls = listOf(url)))
        val text = withRetry(1) { http.postJson("https://api.tavily.com/extract", body, auth()) }
        return JarvisJson.decodeFromString(TavilyExtractResponse.serializer(), text)
            .results.firstOrNull()?.rawContent
    }

    private fun auth() = mapOf("Authorization" to "Bearer ${apiKey()}")
}

@Serializable
data class TavilySearchRequest(
    val query: String,
    val topic: String = "general",
    @SerialName("search_depth") val searchDepth: String = "basic",
    @SerialName("max_results") val maxResults: Int = 6,
    @SerialName("time_range") val timeRange: String? = null,
    @SerialName("include_answer") val includeAnswer: Boolean = false,
    @SerialName("include_domains") val includeDomains: List<String>? = null,
    @SerialName("include_images") val includeImages: Boolean = false,
    @SerialName("include_image_descriptions") val includeImageDescriptions: Boolean = false,
)

@Serializable
data class TavilySearchResponse(
    val results: List<TavilyResult> = emptyList(),
    @Serializable(with = TavilyImagesFlex::class) val images: List<TavilyImage> = emptyList(),
)

@Serializable
data class TavilyImage(val url: String = "", val description: String = "")

/** images อาจเป็น ["url", …] หรือ [{url, description}, …] — รับได้ทั้งสองแบบ */
object TavilyImagesFlex : kotlinx.serialization.json.JsonTransformingSerializer<List<TavilyImage>>(
    kotlinx.serialization.builtins.ListSerializer(TavilyImage.serializer()),
) {
    override fun transformDeserialize(element: kotlinx.serialization.json.JsonElement): kotlinx.serialization.json.JsonElement {
        val arr = element as? kotlinx.serialization.json.JsonArray ?: return kotlinx.serialization.json.JsonArray(emptyList())
        return kotlinx.serialization.json.JsonArray(
            arr.mapNotNull { e ->
                when (e) {
                    is kotlinx.serialization.json.JsonObject -> e
                    is kotlinx.serialization.json.JsonPrimitive ->
                        if (e.isString) kotlinx.serialization.json.buildJsonObject { put("url", e) } else null
                    else -> null
                }
            }
        )
    }
}

@Serializable
data class TavilyResult(
    val title: String = "",
    val url: String = "",
    val content: String = "",
    val score: Double = 0.0,
    @SerialName("published_date") val publishedDate: String? = null,
)

@Serializable
data class TavilyExtractRequest(
    val urls: List<String>,
    @SerialName("extract_depth") val extractDepth: String = "basic",
)

@Serializable
data class TavilyExtractResponse(val results: List<TavilyExtracted> = emptyList())

@Serializable
data class TavilyExtracted(
    val url: String = "",
    @SerialName("raw_content") val rawContent: String? = null,
)
