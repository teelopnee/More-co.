package com.smott.jarvis.core.providers

import com.smott.jarvis.core.net.Http
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.jsoup.Jsoup
import org.jsoup.nodes.Document

/** อ่านหน้าเว็บเองโดยตรง — ใช้สำรองเมื่อ Tavily extract ไม่ได้ และใช้หารูปปกข่าว (og:image) */
class PageReader(private val http: Http) {

    data class Page(val url: String, val title: String, val text: String, val image: String?)

    suspend fun read(url: String, maxChars: Int = 8_000): Page {
        val httpUrl = url.toHttpUrlOrNull() ?: throw IllegalArgumentException("URL ไม่ถูกต้อง: $url")
        val html = http.get(httpUrl, BROWSER_HEADERS, maxBytes = 1_500_000)
        val doc = Jsoup.parse(html, url)
        val image = ogImage(doc)
        doc.select("script, style, noscript, nav, footer, header, aside, form, iframe, svg").remove()
        val root = doc.selectFirst("article") ?: doc.selectFirst("main") ?: doc.body()
        val text = root?.text().orEmpty()
        return Page(url, doc.title().ifBlank { url }, text.take(maxChars), image)
    }

    suspend fun ogImage(url: String): String? {
        val httpUrl = url.toHttpUrlOrNull() ?: return null
        val html = http.get(httpUrl, BROWSER_HEADERS, maxBytes = 300_000)
        return ogImage(Jsoup.parse(html, url))
    }

    private fun ogImage(doc: Document): String? =
        listOf("meta[property=og:image]", "meta[property=og:image:url]", "meta[name=twitter:image]")
            .firstNotNullOfOrNull { selector ->
                doc.selectFirst(selector)?.absUrl("content")?.takeIf { it.startsWith("http") }
            }

    companion object {
        val BROWSER_HEADERS = mapOf(
            "User-Agent" to "Mozilla/5.0 (Linux; Android 16; SM-X930) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/131.0 Safari/537.36",
            "Accept" to "text/html,application/xhtml+xml",
            "Accept-Language" to "th,en;q=0.8",
        )
    }
}
