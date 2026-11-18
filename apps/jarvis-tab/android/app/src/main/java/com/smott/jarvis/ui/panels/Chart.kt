@file:OptIn(ExperimentalLayoutApi::class)

package com.smott.jarvis.ui.panels

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smott.jarvis.core.model.ChartRange
import com.smott.jarvis.core.model.ChartSpec
import com.smott.jarvis.core.model.PriceSeries
import com.smott.jarvis.core.model.Turn
import com.smott.jarvis.ui.Dot
import com.smott.jarvis.ui.changeColor
import com.smott.jarvis.ui.chartTime
import com.smott.jarvis.ui.pct
import com.smott.jarvis.ui.price
import com.smott.jarvis.ui.theme.J
import java.util.Locale
import kotlin.math.roundToInt

/** แผงกราฟ: สลับช่วงเวลาได้, หลายตัว = เทียบเป็น % จากจุดเริ่ม, ชี้/แตะเพื่อดูค่า */
@Composable
fun ChartPanel(turn: Turn, spec: ChartSpec, env: PanelEnv, modifier: Modifier, large: Boolean) {
    val range = ChartRange.parse(spec.range)
    val series = spec.symbols.mapNotNull { s -> turn.series.firstOrNull { it.symbol == s && it.range == range } }
    val loading = env.isChartLoading(turn.id)
    val normalized = series.size > 1
    val title = listOf(PanelKind.CHART.header, spec.title).filter { it.isNotBlank() }.joinToString(" · ")

    PanelCard(title, modifier, onPin = if (large) null else ({ env.pin(turn.id, PanelKind.CHART) })) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ChartRange.entries.forEach { r ->
                val selected = r == range
                Text(
                    r.label,
                    style = TextStyle(fontFamily = J.Mono, 
                        fontSize = 12.sp,
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (selected) J.Bg else J.Muted,
                    ),
                    modifier = Modifier
                        .clip(RoundedCornerShape(2.dp))
                        .background(if (selected) J.Accent else Color.Transparent)
                        .clickable(enabled = !loading && !selected) { env.changeRange(turn.id, r) }
                        .padding(horizontal = 9.dp, vertical = 3.dp),
                )
            }
            Spacer(Modifier.weight(1f))
            if (loading) CircularProgressIndicator(Modifier.size(14.dp), color = J.Accent, strokeWidth = 1.5.dp)
        }
        Spacer(Modifier.height(10.dp))

        FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            series.forEachIndexed { i, s ->
                val first = s.points.first().close
                val last = s.points.last().close
                val change = if (first != 0.0) (last / first - 1) * 100 else 0.0
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Dot(J.Series[i % J.Series.size], size = 8.dp)
                    Spacer(Modifier.width(6.dp))
                    Text(s.symbol, style = TextStyle(fontFamily = J.Mono, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = J.Text))
                    Spacer(Modifier.width(6.dp))
                    if (!normalized) {
                        Text(price(last), style = TextStyle(fontFamily = J.Mono, fontSize = 13.sp, color = J.Text))
                        Spacer(Modifier.width(6.dp))
                    }
                    Text(pct(change), style = TextStyle(fontFamily = J.Mono, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = changeColor(change)))
                }
            }
        }
        Spacer(Modifier.height(8.dp))

        val chartHeight = if (large) 380.dp else 220.dp
        if (series.isEmpty()) {
            Box(Modifier.fillMaxWidth().height(chartHeight), contentAlignment = Alignment.Center) {
                Text(if (loading) "กำลังโหลดกราฟ…" else "ไม่มีข้อมูลช่วงนี้", style = J.Small)
            }
        } else {
            LineChart(series, range, normalized, Modifier.fillMaxWidth().height(chartHeight))
        }
        Spacer(Modifier.height(6.dp))
        val note = if (normalized) "เทียบ % จากจุดเริ่มต้นของช่วง" else (series.firstOrNull()?.currency ?: "USD")
        Text("Twelve Data · $note", style = J.Small.copy(color = J.Faint))
    }
}

private class ChartLine(val symbol: String, val color: Color, val times: List<Long>, val values: DoubleArray)

private class ChartData(
    val lines: List<ChartLine>,
    val lo: Double,
    val hi: Double,
    val vMin: Double,
    val vMax: Double,
)

private fun prepare(series: List<PriceSeries>, normalized: Boolean): ChartData? {
    val usable = series.filter { it.points.size >= 2 }
    if (usable.isEmpty()) return null
    val lines = usable.mapIndexed { i, s ->
        val base = s.points.first().close
        val values = DoubleArray(s.points.size) { k ->
            val c = s.points[k].close
            if (normalized && base != 0.0) (c / base - 1.0) * 100.0 else c
        }
        ChartLine(s.symbol, J.Series[i % J.Series.size], s.points.map { it.t }, values)
    }
    var lo = lines.minOf { line -> line.values.minOrNull() ?: 0.0 }
    var hi = lines.maxOf { line -> line.values.maxOrNull() ?: 0.0 }
    if (normalized) {
        lo = minOf(lo, 0.0)
        hi = maxOf(hi, 0.0)
    }
    if (hi - lo < 1e-9) {
        hi += 1.0
        lo -= 1.0
    }
    val pad = (hi - lo) * 0.08
    return ChartData(lines, lo, hi, lo - pad, hi + pad)
}

private fun axisLabel(v: Double, normalized: Boolean): String =
    if (normalized) String.format(Locale.US, "%+.1f%%", v) else price(v)

private fun valueLabel(v: Double, normalized: Boolean): String =
    if (normalized) String.format(Locale.US, "%+.2f%%", v) else price(v)

@Composable
fun LineChart(series: List<PriceSeries>, range: ChartRange, normalized: Boolean, modifier: Modifier) {
    val measurer = rememberTextMeasurer()
    val data = remember(series, normalized) { prepare(series, normalized) }
    var hoverX by remember { mutableStateOf<Float?>(null) }
    val axisStyle = remember { TextStyle(fontFamily = J.Mono, color = J.Faint, fontSize = 10.sp) }
    val hoverStyle = remember { TextStyle(fontFamily = J.Mono, color = J.Text, fontSize = 11.sp, fontWeight = FontWeight.Medium) }

    Canvas(
        modifier.pointerInput(data) {
            awaitPointerEventScope {
                while (true) {
                    val event = awaitPointerEvent()
                    val change = event.changes.firstOrNull() ?: continue
                    when (event.type) {
                        PointerEventType.Exit -> hoverX = null
                        PointerEventType.Release -> if (change.type == PointerType.Touch) hoverX = null
                        else -> hoverX = change.position.x
                    }
                }
            }
        }
    ) {
        val d = data ?: return@Canvas
        val axisW = 54.dp.toPx()
        val top = 22.dp.toPx()
        val bottom = size.height - 18.dp.toPx()
        val left = 0f
        val right = size.width - axisW
        val w = right - left
        val h = bottom - top
        if (w <= 0f || h <= 0f) return@Canvas
        val span = (d.vMax - d.vMin).takeIf { it > 0 } ?: 1.0
        fun yOf(v: Double): Float = (bottom - ((v - d.vMin) / span) * h).toFloat()
        fun xOf(i: Int, n: Int): Float = if (n <= 1) left else left + w * i / (n - 1)

        // เส้นตาราง + ป้ายแกน Y
        for (k in 0..3) {
            val v = d.lo + (d.hi - d.lo) * k / 3.0
            val y = yOf(v)
            drawLine(J.Hud.copy(alpha = 0.16f), Offset(left, y), Offset(right, y), strokeWidth = 1f)
            drawText(measurer, axisLabel(v, normalized), topLeft = Offset(right + 6.dp.toPx(), y - 7.dp.toPx()), style = axisStyle)
        }
        if (normalized) {
            val y0 = yOf(0.0)
            drawLine(
                J.Muted.copy(alpha = 0.6f),
                Offset(left, y0),
                Offset(right, y0),
                strokeWidth = 1f,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 8f)),
            )
        }

        // เส้นราคา
        d.lines.forEach { line ->
            val n = line.values.size
            val path = Path()
            line.values.forEachIndexed { i, v ->
                val x = xOf(i, n)
                val y = yOf(v)
                if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            if (d.lines.size == 1) {
                val fill = Path().apply {
                    addPath(path)
                    lineTo(xOf(n - 1, n), bottom)
                    lineTo(left, bottom)
                    close()
                }
                drawPath(
                    fill,
                    Brush.verticalGradient(listOf(line.color.copy(alpha = 0.22f), Color.Transparent), startY = top, endY = bottom),
                )
            }
            drawPath(path, line.color.copy(alpha = 0.18f), style = Stroke(width = 7.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            drawPath(path, line.color, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        }

        // ป้ายแกน X (ต้นช่วง / ปลายช่วง)
        val times = d.lines.first().times
        drawText(measurer, chartTime(times.first(), range), topLeft = Offset(left, bottom + 4.dp.toPx()), style = axisStyle)
        val endLayout = measurer.measure(chartTime(times.last(), range), axisStyle)
        drawText(endLayout, topLeft = Offset(right - endLayout.size.width, bottom + 4.dp.toPx()))

        // ค่าที่ตำแหน่งเมาส์/นิ้ว
        val hx = hoverX
        if (hx != null) {
            val frac = ((hx - left) / w).coerceIn(0f, 1f)
            val cx = left + frac * w
            drawLine(J.Muted.copy(alpha = 0.5f), Offset(cx, top), Offset(cx, bottom), strokeWidth = 1f)
            val parts = d.lines.map { line ->
                val i = (frac * (line.values.size - 1)).roundToInt()
                drawCircle(line.color, radius = 4.dp.toPx(), center = Offset(xOf(i, line.values.size), yOf(line.values[i])))
                "${line.symbol} ${valueLabel(line.values[i], normalized)}"
            }
            val i0 = (frac * (times.size - 1)).roundToInt()
            val label = chartTime(times[i0], range) + "   " + parts.joinToString("   ")
            val layout = measurer.measure(
                label,
                hoverStyle,
                overflow = TextOverflow.Ellipsis,
                softWrap = false,
                maxLines = 1,
                constraints = Constraints(maxWidth = size.width.toInt().coerceAtLeast(1)),
            )
            drawText(layout, topLeft = Offset(left, 0f))
        }
    }
}
