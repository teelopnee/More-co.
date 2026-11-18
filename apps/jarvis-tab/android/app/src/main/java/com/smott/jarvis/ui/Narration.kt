package com.smott.jarvis.ui

import com.smott.jarvis.core.model.Effect
import com.smott.jarvis.core.model.Turn
import com.smott.jarvis.ui.panels.PanelKind
import com.smott.jarvis.ui.panels.tileKey
import java.util.Locale

/**
 * "อธิบายให้ฟัง": ลำดับแผงที่จะอ่าน (key ของแผง, ข้อความที่พูด)
 * key ตรงกับแผงบนจอ หน้าจอจึงไฮไลต์แผงที่กำลังพูดถึงได้
 */
fun narration(turn: Turn): List<Pair<String, String>> {
    val b = turn.briefing ?: return emptyList()
    return buildList {
        b.overview?.let { o ->
            val text = (listOf(o.headline) + o.points.map { it.text }).filter { it.isNotBlank() }.joinToString(" ")
            if (text.isNotBlank()) add(tileKey(PanelKind.OVERVIEW) to text)
        }
        b.stats.forEachIndexed { i, s -> add(tileKey(PanelKind.STAT, "$i") to "${s.label} ${s.value}") }
        b.analysis.forEachIndexed { i, a ->
            add(tileKey(PanelKind.TEXT, "$i") to listOf(a.heading, a.body).filter { it.isNotBlank() }.joinToString(". "))
        }
        b.figures.forEachIndexed { i, f ->
            val pts = f.labels.zip(f.values).joinToString(", ") { (l, v) -> "$l ${spoken(v)}" }
            add(tileKey(PanelKind.FIGURE, "$i") to "${f.title} ${f.unit}: $pts")
        }
        if (b.factors.isNotEmpty()) {
            add(
                tileKey(PanelKind.FACTORS) to b.factors.joinToString(" ") { f ->
                    val effect = when (f.effect) {
                        Effect.POSITIVE -> "เป็นบวก"
                        Effect.NEGATIVE -> "เป็นลบ"
                        Effect.MIXED -> "มีทั้งบวกและลบ"
                    }
                    "${f.name} $effect ${f.detail}"
                }
            )
        }
        if (b.recommendations.isNotEmpty()) {
            add(tileKey(PanelKind.RECOMMENDATIONS) to b.recommendations.joinToString(" ") { it.text })
        }
    }
}

private fun spoken(v: Double): String =
    if (v == Math.floor(v) && kotlin.math.abs(v) < 1e12) String.format(Locale.US, "%,.0f", v) else String.format(Locale.US, "%.1f", v)
