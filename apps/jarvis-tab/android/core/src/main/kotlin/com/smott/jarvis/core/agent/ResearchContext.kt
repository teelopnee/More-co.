package com.smott.jarvis.core.agent

import com.smott.jarvis.core.model.ChartRange
import com.smott.jarvis.core.model.MediaImage
import com.smott.jarvis.core.model.PriceSeries
import com.smott.jarvis.core.model.Quote
import com.smott.jarvis.core.model.Source
import com.smott.jarvis.core.model.SourceKind
import com.smott.jarvis.core.tools.hostOf

/**
 * ทะเบียนที่มาและข้อมูลตลาดระหว่างตอบ 1 คำถาม
 * - id ต่อเนื่องจากคำถามก่อนหน้า (S1…Sn) จึงอ้างที่มาเดิมได้เมื่อถามต่อ
 * - URL ซ้ำได้ id เดิม
 * - เครื่องมือหลายตัวทำงานพร้อมกัน จึงล็อกทุกครั้ง
 */
class ResearchContext(earlier: List<Source>) {
    private val lock = Any()
    private val byId = LinkedHashMap<String, Source>()
    private val byUrl = HashMap<String, Source>()
    private val created = ArrayList<Source>()
    private val quoteMap = LinkedHashMap<String, Quote>()
    private val seriesMap = LinkedHashMap<String, PriceSeries>()
    private val imageList = ArrayList<MediaImage>()
    private var nextId = 1

    /** แจ้งทุกครั้งที่มีที่มา/ภาพใหม่ — ให้หน้าจอแสดงแผงทยอยขึ้นมาระหว่างค้น */
    @Volatile
    var onChange: (() -> Unit)? = null

    init {
        earlier.forEach { s ->
            byId[s.id] = s
            byUrl[key(s.url)] = s
            val n = s.id.removePrefix("S").toIntOrNull()
            if (n != null && n >= nextId) nextId = n + 1
        }
    }

    fun register(
        kind: SourceKind,
        title: String,
        url: String,
        publisher: String = hostOf(url),
        publishedAt: Long? = null,
        snippet: String = "",
        imageUrl: String? = null,
        videoId: String? = null,
        platform: String? = null,
    ): Source = synchronized(lock) {
        val k = key(url)
        byUrl[k] ?: Source(
            id = "S${nextId++}",
            kind = kind,
            title = title.trim().take(240),
            url = url.trim(),
            publisher = publisher,
            publishedAt = publishedAt,
            snippet = snippet,
            imageUrl = imageUrl,
            videoId = videoId,
            platform = platform,
        ).also {
            byId[it.id] = it
            byUrl[k] = it
            created += it
        }
    }.also { onChange?.invoke() }

    /** เก็บภาพประกอบ (ไม่ซ้ำ, สูงสุด 12 ภาพ) */
    fun addImage(url: String, description: String, query: String) {
        val added = synchronized(lock) {
            val u = url.trim()
            if (!u.startsWith("https://") || imageList.size >= 12 || imageList.any { it.url == u }) return@synchronized false
            imageList += MediaImage(u, description.trim().take(200), query)
            true
        }
        if (added) onChange?.invoke()
    }

    fun images(): List<MediaImage> = synchronized(lock) { imageList.toList() }

    fun get(id: String): Source? = synchronized(lock) { byId[id.trim().uppercase()] }

    fun ids(): Set<String> = synchronized(lock) { byId.keys.toSet() }

    fun newSources(): List<Source> = synchronized(lock) { created.toList() }

    fun putQuote(quote: Quote) {
        synchronized(lock) { quoteMap[quote.symbol] = quote }
    }

    fun quote(symbol: String): Quote? = synchronized(lock) { quoteMap[symbol] }

    fun quotes(): List<Quote> = synchronized(lock) { quoteMap.values.toList() }

    fun putSeries(series: PriceSeries) {
        synchronized(lock) { seriesMap["${series.symbol}|${series.range}"] = series }
    }

    fun series(symbol: String, range: ChartRange): PriceSeries? = synchronized(lock) { seriesMap["$symbol|$range"] }

    fun allSeries(): List<PriceSeries> = synchronized(lock) { seriesMap.values.toList() }

    private fun key(url: String) = url.trim().substringBefore('#').trimEnd('/').lowercase()
}

/** บันทึกขั้นตอนการทำงานแบบสด ๆ ให้หน้าจอแสดง */
internal class Trace(private val emit: (List<com.smott.jarvis.core.model.TraceStep>) -> Unit) {
    private val steps = ArrayList<com.smott.jarvis.core.model.TraceStep>()

    fun add(label: String, detail: String = ""): Int = synchronized(this) {
        steps += com.smott.jarvis.core.model.TraceStep(label, detail)
        emit(steps.toList())
        steps.lastIndex
    }

    fun done(index: Int, detail: String? = null) =
        update(index) { it.copy(done = true, detail = detail ?: it.detail) }

    fun fail(index: Int, detail: String) =
        update(index) { it.copy(done = true, failed = true, detail = detail.ifBlank { it.detail }) }

    private fun update(index: Int, change: (com.smott.jarvis.core.model.TraceStep) -> com.smott.jarvis.core.model.TraceStep) {
        synchronized(this) {
            if (index in steps.indices) {
                steps[index] = change(steps[index])
                emit(steps.toList())
            }
        }
    }
}
