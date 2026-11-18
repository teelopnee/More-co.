package com.smott.jarvis.core.market

import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId

/** สถานะตลาดหุ้นสหรัฐฯ ตอนนี้ — ให้โมเดลเข้าใจว่า "วันนี้" หมายถึงรอบไหน (เวลาไทยกับนิวยอร์กต่างกัน) */
object MarketClock {
    private val NY = ZoneId.of("America/New_York")

    fun usStatus(now: Instant = Instant.now()): String {
        val t = now.atZone(NY)
        val minutes = t.hour * 60 + t.minute
        val weekend = t.dayOfWeek == DayOfWeek.SATURDAY || t.dayOfWeek == DayOfWeek.SUNDAY
        val state = when {
            weekend -> "closed (weekend)"
            minutes < 4 * 60 -> "closed (overnight)"
            minutes < 9 * 60 + 30 -> "pre-market"
            minutes < 16 * 60 -> "open (regular session)"
            minutes < 20 * 60 -> "after-hours"
            else -> "closed (overnight)"
        }
        return "$state; US holidays are not detected automatically"
    }
}
