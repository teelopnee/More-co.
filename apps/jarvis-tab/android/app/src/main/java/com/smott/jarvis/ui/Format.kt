package com.smott.jarvis.ui

import androidx.compose.ui.graphics.Color
import com.smott.jarvis.core.model.ChartRange
import com.smott.jarvis.core.model.Effect
import com.smott.jarvis.core.model.Mood
import com.smott.jarvis.core.model.Risk
import com.smott.jarvis.ui.theme.J
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs

private val TH = Locale.forLanguageTag("th-TH")
private val CLOCK = DateTimeFormatter.ofPattern("HH:mm", TH)
private val DAY = DateTimeFormatter.ofPattern("d MMM", TH)
private val DAY_TIME = DateTimeFormatter.ofPattern("d MMM HH:mm", TH)
private val WEEKDAY_TIME = DateTimeFormatter.ofPattern("EEE HH:mm", TH)

private fun local(millis: Long) = Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault())

fun clock(millis: Long): String = CLOCK.format(local(millis))

fun dayLabel(millis: Long): String = DAY.format(local(millis))

fun chartTime(millis: Long, range: ChartRange): String = when (range) {
    ChartRange.D1 -> CLOCK.format(local(millis))
    ChartRange.D5 -> WEEKDAY_TIME.format(local(millis))
    else -> DAY.format(local(millis))
}

fun timeAgo(millis: Long?): String {
    if (millis == null || millis <= 0) return ""
    val diff = System.currentTimeMillis() - millis
    val min = diff / 60_000
    return when {
        min < 1 -> "เมื่อสักครู่"
        min < 60 -> "$min นาทีที่แล้ว"
        min < 24 * 60 -> "${min / 60} ชม.ที่แล้ว"
        min < 7 * 24 * 60 -> "${min / (24 * 60)} วันที่แล้ว"
        else -> DAY_TIME.format(local(millis))
    }
}

fun price(v: Double): String = if (abs(v) >= 1000) String.format(Locale.US, "%,.0f", v) else String.format(Locale.US, "%,.2f", v)

fun pct(v: Double): String = String.format(Locale.US, "%+.2f%%", v)

fun changeColor(v: Double): Color = when {
    v > 0.0001 -> J.Up
    v < -0.0001 -> J.Down
    else -> J.Muted
}

fun moodLabel(m: Mood): Pair<String, Color> = when (m) {
    Mood.BULLISH -> "เชิงบวก" to J.Up
    Mood.BEARISH -> "เชิงลบ" to J.Down
    Mood.MIXED -> "ผสม" to J.Warn
    Mood.NEUTRAL -> "ทรงตัว" to J.Muted
}

fun effectGlyph(e: Effect): Pair<String, Color> = when (e) {
    Effect.POSITIVE -> "▲" to J.Up
    Effect.NEGATIVE -> "▼" to J.Down
    Effect.MIXED -> "◆" to J.Warn
}

fun riskLabel(r: Risk): Pair<String, Color> = when (r) {
    Risk.LOW -> "เสี่ยงต่ำ" to J.Up
    Risk.MEDIUM -> "เสี่ยงกลาง" to J.Warn
    Risk.HIGH -> "เสี่ยงสูง" to J.Down
}
