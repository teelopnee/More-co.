package com.smott.jarvis.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import com.smott.jarvis.ui.theme.J
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

private fun rad(deg: Float): Float = (deg * PI / 180.0).toFloat()

private fun polar(c: Offset, r: Float, deg: Float) = Offset(c.x + r * cos(rad(deg)), c.y + r * sin(rad(deg)))

/**
 * "เครื่องปฏิกรณ์" สีชมพู = ตัวผู้ช่วย
 * - ว่าง: หมุนช้า ๆ มีกากบาทกลาง
 * - ฟัง: วงกระเพื่อมตามระดับเสียง
 * - คิด: แสงวิ่งรอบวง
 * - พูด: วงหายใจ มีชื่อตรงกลาง
 * booting = วงแหวนเอียง 3 มิติหมุนตอนเปิดแอป แล้วค่อยกลายเป็นลูกแก้ว
 */
@Composable
fun ReactorOrb(
    state: OrbState,
    level: Float,
    name: String,
    modifier: Modifier = Modifier,
    booting: Boolean = false,
    flash: Int = 0,
    onClick: (() -> Unit)? = null,
) {
    // ถูกปลุก: วงแสงขยายออกจากลูกแก้ว + สว่างวาบ
    val burst = remember { Animatable(1f) }
    LaunchedEffect(flash) {
        if (flash > 0) {
            burst.snapTo(0f)
            burst.animateTo(1f, tween(1100, easing = FastOutSlowInEasing))
        }
    }
    val t = rememberInfiniteTransition(label = "reactor")
    val slow by t.animateFloat(0f, 360f, infiniteRepeatable(tween(40_000, easing = LinearEasing)), label = "slow")
    val mid by t.animateFloat(0f, 360f, infiniteRepeatable(tween(10_000, easing = LinearEasing)), label = "mid")
    val fast by t.animateFloat(0f, 360f, infiniteRepeatable(tween(1_500, easing = LinearEasing)), label = "fast")
    val boot by t.animateFloat(0f, 360f, infiniteRepeatable(tween(2_600, easing = LinearEasing)), label = "boot")
    val breathe by t.animateFloat(0f, 1f, infiniteRepeatable(tween(1_300, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "breathe")
    val lvl by animateFloatAsState(level.coerceIn(0f, 1f), tween(110), label = "lvl")
    val energy by animateFloatAsState(
        when (state) {
            OrbState.IDLE -> 0.3f
            OrbState.LISTENING -> 0.65f
            OrbState.THINKING -> 0.85f
            OrbState.SPEAKING -> 1f
        },
        tween(450),
        label = "energy",
    )
    val orbAlpha by animateFloatAsState(if (booting) 0f else 1f, tween(800), label = "orb-alpha")
    val measurer = rememberTextMeasurer()
    val click = if (onClick != null) {
        Modifier.clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClick)
    } else {
        Modifier
    }

    Box(modifier.then(click)) {
        if (booting) Canvas(Modifier.fillMaxSize()) { drawBootRings(boot) }
        Canvas(Modifier.fillMaxSize().graphicsLayer { alpha = orbAlpha }) {
            drawReactor(state, lvl, (energy + 0.6f * (1f - burst.value)).coerceAtMost(1.4f), name, slow, mid, fast, breathe, measurer)
            if (burst.value < 1f) {
                val p = burst.value
                val r = size.minDimension * 0.43f
                drawCircle(J.RoseHi.copy(alpha = 0.85f * (1f - p)), radius = r * (0.64f + 0.75f * p), center = center, style = Stroke(r * 0.03f * (1f - p) + 1f))
                drawCircle(J.Rose.copy(alpha = 0.35f * (1f - p)), radius = r * (0.64f + 1.1f * p), center = center, style = Stroke(r * 0.12f * (1f - p) + 1f))
            }
        }
    }
}

private fun DrawScope.drawReactor(
    state: OrbState,
    level: Float,
    energy: Float,
    name: String,
    slow: Float,
    mid: Float,
    fast: Float,
    breathe: Float,
    measurer: TextMeasurer,
) {
    val c = center
    val r = size.minDimension * 0.43f
    val thin = (r * 0.012f).coerceAtLeast(1f)

    // แสงเรืองรอบลูกแก้ว
    drawCircle(
        Brush.radialGradient(
            0f to J.Rose.copy(alpha = (0.30f + 0.25f * energy).coerceAtMost(1f)),
            0.55f to J.Rose.copy(alpha = (0.10f * energy).coerceAtMost(1f)),
            1f to Color.Transparent,
            center = c,
            radius = r * 1.55f,
        ),
        radius = r * 1.55f,
        center = c,
    )

    // ขีดรอบนอก 90 ขีด หมุนช้า
    for (i in 0 until 90) {
        val a = i * 4f + slow
        val long = i % 5 == 0
        val len = if (long) r * 0.08f else r * 0.04f
        drawLine(
            if (long) J.RoseHi.copy(alpha = 0.9f) else Color.White.copy(alpha = 0.45f),
            polar(c, r * 0.93f, a),
            polar(c, r * 0.93f + len, a),
            strokeWidth = if (long) thin * 1.6f else thin,
        )
    }
    drawCircle(J.RoseHi.copy(alpha = 0.5f), radius = r * 0.905f, center = c, style = Stroke(thin))

    // ส่วนโค้งหมุนสวนทางกัน
    val arcs1 = listOf(0f to 70f, 90f to 25f, 140f to 60f, 232f to 14f, 262f to 80f)
    arcs1.forEach { (start, sweep) ->
        drawArc(
            Color.White.copy(alpha = 0.78f),
            startAngle = start - mid * 2f,
            sweepAngle = sweep,
            useCenter = false,
            topLeft = Offset(c.x - r * 0.83f, c.y - r * 0.83f),
            size = Size(r * 1.66f, r * 1.66f),
            style = Stroke(r * 0.02f, cap = StrokeCap.Butt),
        )
    }
    val arcs2 = listOf(20f to 40f, 120f to 30f, 200f to 52f, 300f to 22f)
    arcs2.forEach { (start, sweep) ->
        drawArc(
            J.Rose.copy(alpha = 0.95f),
            startAngle = start + mid,
            sweepAngle = sweep,
            useCenter = false,
            topLeft = Offset(c.x - r * 0.765f, c.y - r * 0.765f),
            size = Size(r * 1.53f, r * 1.53f),
            style = Stroke(r * 0.012f),
        )
    }

    // วงหลักเรืองแสง
    val ringR = r * 0.64f * when (state) {
        OrbState.LISTENING -> 1f + 0.14f * level
        OrbState.SPEAKING -> 1f + 0.035f * breathe
        else -> 1f
    }
    drawCircle(J.Rose.copy(alpha = (0.07f + 0.05f * energy).coerceAtMost(1f)), radius = ringR, center = c, style = Stroke(r * 0.22f))
    drawCircle(J.Rose.copy(alpha = (0.16f + 0.08f * energy).coerceAtMost(1f)), radius = ringR, center = c, style = Stroke(r * 0.14f))
    drawCircle(J.Rose, radius = ringR, center = c, style = Stroke(r * 0.075f))
    drawCircle(J.RoseHi.copy(alpha = 0.95f), radius = ringR - r * 0.012f, center = c, style = Stroke(r * 0.02f))
    drawCircle(J.Rose.copy(alpha = 0.6f), radius = ringR + r * 0.055f, center = c, style = Stroke(thin))

    when (state) {
        OrbState.THINKING -> {
            // แสงวิ่งรอบวง
            val box = Size(ringR * 2f, ringR * 2f)
            val tl = Offset(c.x - ringR, c.y - ringR)
            drawArc(Color.White.copy(alpha = 0.95f), fast * 1f, 95f, false, tl, box, style = Stroke(r * 0.045f, cap = StrokeCap.Round))
            drawArc(J.RoseHi.copy(alpha = 0.9f), fast * 1f + 180f, 40f, false, tl, box, style = Stroke(r * 0.045f, cap = StrokeCap.Round))
        }
        OrbState.LISTENING -> {
            // คลื่นกระเพื่อมออกจากวง
            drawCircle(
                J.Rose.copy(alpha = 0.55f * (1f - breathe)),
                radius = r * (0.7f + 0.22f * breathe),
                center = c,
                style = Stroke(thin * 1.5f),
            )
        }
        else -> Unit
    }

    // จานในสีเข้ม
    drawCircle(Color(0xFF12030A).copy(alpha = 0.94f), radius = r * 0.53f, center = c)
    drawCircle(J.Rose.copy(alpha = 0.45f), radius = r * 0.535f, center = c, style = Stroke(thin))

    if (state == OrbState.IDLE) {
        // กากบาทเล็งเป้า
        val cross = J.RoseHi.copy(alpha = 0.8f)
        drawLine(cross, Offset(c.x - r * 0.46f, c.y), Offset(c.x - r * 0.07f, c.y), strokeWidth = thin)
        drawLine(cross, Offset(c.x + r * 0.07f, c.y), Offset(c.x + r * 0.46f, c.y), strokeWidth = thin)
        drawLine(cross, Offset(c.x, c.y - r * 0.46f), Offset(c.x, c.y - r * 0.07f), strokeWidth = thin)
        drawLine(cross, Offset(c.x, c.y + r * 0.07f), Offset(c.x, c.y + r * 0.46f), strokeWidth = thin)
        drawCircle(cross, radius = r * 0.03f, center = c, style = Stroke(thin))
        rotate(slow * 3f, pivot = c) {
            drawArc(
                J.Rose.copy(alpha = 0.85f), 0f, 50f, false,
                Offset(c.x - r * 0.3f, c.y - r * 0.3f), Size(r * 0.6f, r * 0.6f), style = Stroke(thin * 1.4f),
            )
        }
    } else if (name.isNotBlank()) {
        val fs = (r * 0.25f).toSp()
        val base = TextStyle(fontFamily = J.Mono, fontWeight = FontWeight.Bold, fontStyle = FontStyle.Italic, fontSize = fs)
        val glow = measurer.measure(name.uppercase(), base.copy(color = J.Rose.copy(alpha = 0.8f)))
        val main = measurer.measure(name.uppercase(), base.copy(color = Color.White))
        val tl = Offset(c.x - main.size.width / 2f, c.y - main.size.height / 2f - r * 0.04f)
        drawText(glow, topLeft = Offset(tl.x - r * 0.014f, tl.y + r * 0.014f))
        drawText(glow, topLeft = Offset(tl.x + r * 0.014f, tl.y - r * 0.01f))
        drawText(main, topLeft = tl)
    }

    // ป้ายเล็กใต้ชื่อ (เฉพาะตอนลูกแก้วใหญ่พอจะอ่านออก)
    if (r > 70.dp.toPx()) {
        val caption = when (state) {
            OrbState.IDLE -> "STANDBY"
            OrbState.LISTENING -> "LISTENING"
            OrbState.THINKING -> "PROCESSING"
            OrbState.SPEAKING -> "TRANSMITTING"
        }
        val layout = measurer.measure(
            caption,
            TextStyle(fontFamily = J.Mono, fontWeight = FontWeight.Bold, fontSize = (r * 0.058f).toSp(), color = J.RoseHi.copy(alpha = 0.85f), letterSpacing = (r * 0.012f).toSp()),
        )
        drawText(layout, topLeft = Offset(c.x - layout.size.width / 2f, c.y + r * 0.33f))
    }

    // เครื่องหมายบวกเล็ก ๆ 4 มุมทแยง
    for (k in 0 until 4) {
        val p = polar(c, r * 1.1f, 45f + 90f * k)
        val s = r * 0.035f
        drawLine(J.Muted.copy(alpha = 0.75f), Offset(p.x - s, p.y), Offset(p.x + s, p.y), strokeWidth = thin)
        drawLine(J.Muted.copy(alpha = 0.75f), Offset(p.x, p.y - s), Offset(p.x, p.y + s), strokeWidth = thin)
    }
}

/** วงแหวนเอียง 3 มิติที่หมุนรอบแกนสีแดง (ฉากเปิดเครื่อง) */
private fun DrawScope.drawBootRings(angle: Float) {
    val c = center
    val r = size.minDimension * 0.43f
    val tilt = -22f
    val thin = (r * 0.012f).coerceAtLeast(1f)

    // แกนสีแดง
    drawLine(J.Rose, polar(c, r * 1.05f, tilt + 180f), polar(c, r * 1.05f, tilt), strokeWidth = thin * 1.4f)

    fun ellipse(radius: Float, phase: Float, color: Color, width: Float, effect: PathEffect? = null) {
        val sx = abs(cos(rad(angle + phase))).coerceAtLeast(0.04f)
        rotate(tilt, pivot = c) {
            drawOval(
                color,
                topLeft = Offset(c.x - radius * sx, c.y - radius),
                size = Size(radius * 2f * sx, radius * 2f),
                style = Stroke(width, pathEffect = effect),
            )
        }
    }
    // ชมพูหนา (+เรืองแสง)
    ellipse(r * 0.55f, 0f, J.Rose.copy(alpha = 0.18f), r * 0.2f)
    ellipse(r * 0.55f, 0f, J.Rose, r * 0.07f)
    ellipse(r * 0.55f, 0f, J.RoseHi.copy(alpha = 0.9f), r * 0.018f)
    // ขาวเป็นช่วง ๆ
    ellipse(r * 0.9f, 60f, Color.White.copy(alpha = 0.75f), thin * 1.6f, PathEffect.dashPathEffect(floatArrayOf(r * 0.16f, r * 0.05f)))
    // จุดไข่ปลาวงนอก
    ellipse(r * 1.05f, 120f, Color.White.copy(alpha = 0.55f), thin * 1.8f, PathEffect.dashPathEffect(floatArrayOf(1f, r * 0.06f)))
    ellipse(r * 0.72f, 30f, J.Muted.copy(alpha = 0.6f), thin)
}
