package com.smott.jarvis.core.model

import kotlinx.serialization.Serializable

@Serializable
enum class SourceKind { WEB, NEWS, DATA, VIDEO }

/** แหล่งที่มา 1 รายการ — id เช่น "S3" ใช้อ้างอิงในบทวิเคราะห์ และคงที่ตลอดเซสชัน */
@Serializable
data class Source(
    val id: String,
    val kind: SourceKind,
    val title: String,
    val url: String,
    val publisher: String = "",
    val publishedAt: Long? = null,
    val snippet: String = "",
    val imageUrl: String? = null,
    /** คลิปวิดีโอ: รหัสคลิปบนแพลตฟอร์ม (เช่น YouTube "dQw4w9WgXcQ") */
    val videoId: String? = null,
    /** "youtube" หรือ "tiktok" */
    val platform: String? = null,
)

/** ภาพประกอบจากผลค้นเว็บ (ไม่ใช่ที่มาของข้อเท็จจริง จึงไม่มีเลขอ้างอิง) */
@Serializable
data class MediaImage(val url: String, val description: String = "", val query: String = "")

@Serializable
data class Quote(
    val symbol: String,
    val price: Double,
    val change: Double,
    val changePct: Double,
    val high: Double,
    val low: Double,
    val open: Double,
    val prevClose: Double,
    val time: Long,
)

@Serializable
data class PricePoint(val t: Long, val close: Double)

@Serializable
enum class ChartRange(val label: String) {
    D1("1D"), D5("5D"), M1("1M"), M6("6M"), Y1("1Y");

    companion object {
        fun parse(value: String?): ChartRange {
            val v = value?.trim().orEmpty()
            return entries.firstOrNull { it.label.equals(v, ignoreCase = true) || it.name.equals(v, ignoreCase = true) }
                ?: M1
        }
    }
}

/** ราคาย้อนหลังจาก API จริง — กราฟวาดจากข้อมูลนี้เท่านั้น ไม่ใช้ตัวเลขจากโมเดล */
@Serializable
data class PriceSeries(
    val symbol: String,
    val range: ChartRange,
    val points: List<PricePoint>,
    val currency: String? = null,
)
