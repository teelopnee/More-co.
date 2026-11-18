@file:OptIn(ExperimentalSerializationApi::class)

package com.smott.jarvis.core.model

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNames

/*
 * Briefing = คำตอบ 1 รอบที่แสดงเป็นหลายแผงบนหน้าจอ
 * โมเดลเป็นคนเลือก "เนื้อหา" ส่วนตัวเลขราคา/กราฟ แอปดึงจาก API เอง
 */

@Serializable
enum class Mood {
    @SerialName("bullish") BULLISH,
    @SerialName("bearish") BEARISH,
    @SerialName("mixed") MIXED,
    @SerialName("neutral") NEUTRAL,
}

@Serializable
enum class Effect {
    @SerialName("positive") POSITIVE,
    @SerialName("negative") NEGATIVE,
    @SerialName("mixed") MIXED,
}

@Serializable
enum class Risk {
    @SerialName("low") LOW,
    @SerialName("medium") MEDIUM,
    @SerialName("high") HIGH,
}

/** ข้อความ + รหัสที่มาที่รองรับ */
@Serializable
data class Cited(
    val text: String = "",
    @Serializable(with = IdList::class) val sources: List<String> = emptyList(),
)

@Serializable
data class Overview(
    val headline: String = "",
    val mood: Mood = Mood.NEUTRAL,
    @Serializable(with = CitedList::class) val points: List<Cited> = emptyList(),
)

@Serializable
data class ChartSpec(
    val title: String = "",
    @Serializable(with = IdList::class) val symbols: List<String> = emptyList(),
    val range: String = "1M",
)

@Serializable
data class NewsRef(
    @JsonNames("source_id", "id") val sourceId: String = "",
    val why: String = "",
)

@Serializable
data class Factor(
    val name: String = "",
    val effect: Effect = Effect.MIXED,
    val detail: String = "",
    @Serializable(with = IdList::class) val sources: List<String> = emptyList(),
)

@Serializable
data class AnalysisBlock(
    val heading: String = "",
    val body: String = "",
    @Serializable(with = IdList::class) val sources: List<String> = emptyList(),
)

@Serializable
data class Recommendation(
    val text: String = "",
    val risk: Risk = Risk.MEDIUM,
    @Serializable(with = IdList::class) val sources: List<String> = emptyList(),
)

/** ตัวเลขสำคัญตัวโต ๆ เช่น "≈20M" + คำอธิบาย (ต้องมีที่มา) */
@Serializable
data class Stat(
    val value: String = "",
    val label: String = "",
    @Serializable(with = IdList::class) val sources: List<String> = emptyList(),
)

/** กราฟแท่งจากตัวเลขในที่มา (ไม่ใช่ราคาหุ้น) เช่น ยอดขายแต่ละปี */
@Serializable
data class Figure(
    val title: String = "",
    val unit: String = "",
    @Serializable(with = TextList::class) val labels: List<String> = emptyList(),
    val values: List<Double> = emptyList(),
    val note: String = "",
    @Serializable(with = IdList::class) val sources: List<String> = emptyList(),
)

@Serializable
data class Briefing(
    val title: String = "",
    val spoken: String = "",
    @Serializable(with = OverviewFlex::class) val overview: Overview? = null,
    val chart: ChartSpec? = null,
    @Serializable(with = IdList::class) val watchlist: List<String> = emptyList(),
    @Serializable(with = NewsList::class) val news: List<NewsRef> = emptyList(),
    @Serializable(with = FactorList::class) val factors: List<Factor> = emptyList(),
    @Serializable(with = AnalysisList::class) val analysis: List<AnalysisBlock> = emptyList(),
    @Serializable(with = RecommendationList::class) val recommendations: List<Recommendation> = emptyList(),
    @Serializable(with = NewsList::class) val videos: List<NewsRef> = emptyList(),
    @Serializable(with = StatList::class) val stats: List<Stat> = emptyList(),
    @Serializable(with = FigureList::class) val figures: List<Figure> = emptyList(),
    @JsonNames("follow_ups", "followups")
    @Serializable(with = TextList::class) val followUps: List<String> = emptyList(),
) {
    /** ทุก id ที่ถูกอ้างถึงในคำตอบนี้ */
    fun citedIds(): Set<String> = buildSet {
        overview?.points?.forEach { addAll(it.sources) }
        factors.forEach { addAll(it.sources) }
        analysis.forEach { addAll(it.sources) }
        recommendations.forEach { addAll(it.sources) }
        news.forEach { add(it.sourceId) }
        videos.forEach { add(it.sourceId) }
        stats.forEach { addAll(it.sources) }
        figures.forEach { addAll(it.sources) }
    }
}
