package com.smott.jarvis.core.tools

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import kotlin.math.round

fun hostOf(url: String): String = url.toHttpUrlOrNull()?.host?.removePrefix("www.").orEmpty()

/** อ่านวันที่ได้หลายรูปแบบ (RFC 1123 ของ Tavily, ISO, วันที่ล้วน) */
fun parseDateMillis(raw: String?): Long? {
    val s = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    return runCatching { ZonedDateTime.parse(s, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(s).toInstant().toEpochMilli() }.getOrNull()
        ?: runCatching { Instant.parse(s).toEpochMilli() }.getOrNull()
        ?: runCatching { LocalDateTime.parse(s).atZone(ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull()
        ?: runCatching { LocalDate.parse(s.take(10)).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull()
}

fun isoTime(millis: Long): String =
    DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(
        Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).truncatedTo(ChronoUnit.MINUTES)
    )

fun Double.r2(): Double = round(this * 100.0) / 100.0
