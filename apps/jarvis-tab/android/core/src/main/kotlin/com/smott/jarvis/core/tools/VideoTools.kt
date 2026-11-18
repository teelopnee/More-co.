package com.smott.jarvis.core.tools

import com.smott.jarvis.core.agent.ResearchContext
import com.smott.jarvis.core.model.SourceKind
import com.smott.jarvis.core.providers.TavilyClient
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** คลิปที่แอปฝังเล่นในแผงได้ */
data class VideoRef(val platform: String, val id: String) {
    val watchUrl: String
        get() = if (platform == YOUTUBE) "https://www.youtube.com/watch?v=$id" else "https://www.tiktok.com/video/$id"

    val thumbnail: String?
        get() = if (platform == YOUTUBE) "https://i.ytimg.com/vi/$id/hqdefault.jpg" else null

    companion object {
        const val YOUTUBE = "youtube"
        const val TIKTOK = "tiktok"
        private val YT_ID = Regex("^[A-Za-z0-9_-]{11}$")
        private val TT_ID = Regex("^\\d{8,25}$")

        /** อ่านลิงก์ YouTube/TikTok ทุกแบบที่พบบ่อย; ไม่ใช่คลิป → null */
        fun parse(url: String): VideoRef? {
            val u = url.trim().toHttpUrlOrNull() ?: return null
            val host = u.host.removePrefix("www.").removePrefix("m.").removePrefix("music.")
            val seg = u.pathSegments.filter { it.isNotBlank() }
            val yt = when (host) {
                "youtu.be" -> seg.firstOrNull()
                "youtube.com", "youtube-nocookie.com" -> when (seg.firstOrNull()) {
                    "watch" -> u.queryParameter("v")
                    "shorts", "embed", "live", "v" -> seg.getOrNull(1)
                    else -> null
                }
                else -> null
            }
            if (yt != null) return if (YT_ID.matches(yt)) VideoRef(YOUTUBE, yt) else null
            if (host == "tiktok.com" || host.endsWith(".tiktok.com")) {
                val i = seg.indexOf("video")
                val id = if (i >= 0) seg.getOrNull(i + 1) else null
                if (id != null && TT_ID.matches(id)) return VideoRef(TIKTOK, id)
            }
            return null
        }
    }
}

/** หาคลิปวิดีโอที่เกี่ยวข้อง (YouTube/TikTok) ผ่าน Tavily — แอปจะฝังเล่นในแผงให้เอง */
class FindVideosTool(private val tavily: TavilyClient) : Tool {
    override val name = "find_videos"
    override val description =
        "Find relevant video clips (YouTube, TikTok) to show playing on the user's screen: product demos, reviews, " +
            "news footage, explainers. Returns source ids with title and channel. Call at most once per question, " +
            "only when moving pictures genuinely help. Then list the best ones in present_briefing.videos."
    override val parameters = Schema.obj(
        "query" to Schema.str("What the video should show, in English for global topics"),
        "max_results" to Schema.int("Number of clips, default 4", 1, 6),
        required = listOf("query"),
    )
    override val available: Boolean get() = tavily.available
    override val requires = "Tavily API key"

    override fun traceLabel(args: JsonObject) = "หาคลิป" to args.str("query").orEmpty()

    override suspend fun run(args: JsonObject, ctx: ResearchContext): String {
        val query = args.str("query") ?: return "ERROR: query is required"
        val max = (args.int("max_results") ?: 4).coerceIn(1, 6)
        val results = tavily.searchFull(
            query = query,
            maxResults = (max * 2).coerceAtMost(12),
            includeDomains = listOf("youtube.com", "youtu.be", "tiktok.com"),
        ).results
        val found = results.mapNotNull { r -> VideoRef.parse(r.url)?.let { r to it } }
            .distinctBy { it.second }
            .take(max)
        if (found.isEmpty()) return "No playable videos found for: $query"
        return buildJsonArray {
            found.forEach { (r, v) ->
                val src = ctx.register(
                    kind = SourceKind.VIDEO,
                    title = r.title.ifBlank { r.url },
                    url = v.watchUrl,
                    publisher = if (v.platform == VideoRef.YOUTUBE) "YouTube" else "TikTok",
                    publishedAt = parseDateMillis(r.publishedDate),
                    snippet = r.content.take(300),
                    imageUrl = v.thumbnail,
                    videoId = v.id,
                    platform = v.platform,
                )
                addJsonObject {
                    put("id", src.id)
                    put("title", src.title)
                    put("platform", v.platform)
                    put("snippet", r.content.take(240))
                }
            }
        }.toString()
    }
}
