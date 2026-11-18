package com.smott.jarvis.ui

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.ui.graphics.lerp
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smott.jarvis.ui.theme.J

/** false = ไม่เล่นแอนิเมชันตอนปรากฏ (ใช้ตอนถ่ายภาพหน้าจอทดสอบ และกับคำตอบเก่าที่เลื่อนกลับเข้ามา) */
val LocalAnimateIn = compositionLocalOf { true }

/** หน่วงการปรากฏของแผง (มิลลิวินาที) ให้แผงโผล่ทีละใบเหมือนข้อมูลทยอยเข้ามา */
val LocalAppearDelay = compositionLocalOf { 0 }

/** เลขลำดับแผงที่มุมขวาบนของหัวแผง เช่น "03/07" */
val LocalTileLabel = compositionLocalOf<String?> { null }

/** แผงนี้กำลังถูกอธิบายด้วยเสียง → กรอบเปลี่ยนเป็นสีชมพูเรืองแสง และเลื่อนจอมาให้เห็น */
val LocalTileFocused = compositionLocalOf { false }

private val HudShape = RoundedCornerShape(3.dp)

/** แท็กเล็ก ๆ กรอบบาง (แทนแคปซูลเดิม) */
@Composable
fun Pill(text: String, color: Color) {
    Text(
        text.uppercase(),
        style = TextStyle(fontFamily = J.Mono, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp, color = color),
        modifier = Modifier
            .clip(RoundedCornerShape(2.dp))
            .background(color.copy(alpha = 0.10f))
            .border(1.dp, color.copy(alpha = 0.7f), RoundedCornerShape(2.dp))
            .padding(horizontal = 7.dp, vertical = 2.dp),
    )
}

@Composable
fun SmallIcon(
    icon: ImageVector,
    description: String,
    tint: Color = J.Muted,
    size: Dp = 36.dp,
    onClick: () -> Unit,
) {
    Box(
        Modifier.size(size).clip(CircleShape).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = description, tint = tint, modifier = Modifier.size(20.dp))
    }
}

/** ปุ่มตัวเล็กกรอบขาวแบบแถบเมนู HUD (HISTORY, CLEAR VIEW …) */
@Composable
fun HudButton(text: String, active: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    val color = when {
        !enabled -> J.Faint
        active -> J.Rose
        else -> J.HudHi
    }
    Text(
        text.uppercase(),
        style = TextStyle(fontFamily = J.Mono, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, color = color),
        maxLines = 1,
        modifier = Modifier
            .clip(RoundedCornerShape(2.dp))
            .border(1.dp, color.copy(alpha = 0.85f), RoundedCornerShape(2.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 9.dp, vertical = 5.dp),
    )
}

@Composable
fun Chip(text: String, selected: Boolean = false, onClick: () -> Unit) {
    Text(
        text,
        style = TextStyle(fontFamily = J.Mono, fontSize = 12.sp, color = if (selected) J.Bg else J.Text),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier
            .clip(HudShape)
            .background(if (selected) J.Accent else J.Hud.copy(alpha = 0.06f))
            .border(1.dp, if (selected) J.Accent else J.Hud.copy(alpha = 0.45f), HudShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp),
    )
}

@Composable
fun Dot(color: Color, size: Dp = 6.dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).clip(CircleShape).background(color))
}

@Composable
fun VLine() {
    Box(Modifier.width(1.dp).fillMaxHeight().background(J.Line))
}

/** ใช้กับหน้าที่วางทับ (ตั้งค่า, ประวัติ, แผงเต็มจอ) — กันไม่ให้แตะทะลุไปโดนหน้าด้านล่าง */
fun Modifier.blockTouches(): Modifier = pointerInput(Unit) { detectTapGestures { } }

/** พื้นหลังหน้าจอ: ดำน้ำเงิน มีแสงฟ้าจาง ๆ ตรงกลางเหมือนจอ HUD */
fun Modifier.hudBackground(): Modifier = background(J.Bg).drawBehind {
    drawRect(
        Brush.radialGradient(
            0f to J.Glow.copy(alpha = 0.55f),
            1f to Color.Transparent,
            center = Offset(size.width * 0.5f, size.height * 0.46f),
            radius = size.maxDimension * 0.55f,
        )
    )
}

private fun DrawScope.corner(x: Float, y: Float, dx: Float, dy: Float, len: Float, color: Color, width: Float) {
    drawLine(color, Offset(x, y), Offset(x + dx * len, y), strokeWidth = width)
    drawLine(color, Offset(x, y), Offset(x, y + dy * len), strokeWidth = width)
}

/**
 * แผง HUD 1 ใบ: กรอบฟ้าเรืองแสง + กรอบในบาง + มุมหนา + จุดชมพูที่มุมบน
 * หัวแผงเป็นตัวเล็ก ๆ แบบ "TEXT // ชื่อ" ปรากฏด้วยแอนิเมชันกะพริบเข้ามา
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HudFrame(
    header: String,
    modifier: Modifier = Modifier,
    accent: Color = J.Hud,
    headerTrailing: @Composable RowScope.() -> Unit = {},
    padding: Dp = 14.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val animate = LocalAnimateIn.current
    var shown by remember { mutableStateOf(!animate) }
    LaunchedEffect(Unit) { shown = true }
    val focused = LocalTileFocused.current
    val bring = remember { BringIntoViewRequester() }
    LaunchedEffect(focused) { if (focused) runCatching { bring.bringIntoView() } }
    val glow by animateFloatAsState(if (focused) 1f else 0f, tween(350), label = "focus")
    val frameColor = lerp(accent, J.Rose, glow)
    val delay = if (animate) LocalAppearDelay.current else 0
    val label = LocalTileLabel.current
    val p by animateFloatAsState(if (shown) 1f else 0f, tween(520, delayMillis = delay, easing = FastOutSlowInEasing), label = "hud-in")
    // กะพริบ 2 จังหวะก่อนนิ่ง เหมือนจอเปิดติด
    val flicker = if (p >= 1f) 1f else if (p < 0.25f) p * 4f else if (p < 0.4f) 0.35f else if (p < 0.55f) 0.9f else 0.7f + 0.3f * p

    Column(
        modifier
            .bringIntoViewRequester(bring)
            .graphicsLayer {
                alpha = flicker
                val s = 0.965f + 0.035f * p
                scaleX = s
                scaleY = s
            }
            .drawBehind {
                val r = 3.dp.toPx()
                val w = size.width
                val h = size.height
                drawRoundRect(
                    Brush.verticalGradient(listOf(J.SurfaceHi.copy(alpha = 0.85f), J.Surface)),
                    cornerRadius = CornerRadius(r),
                )
                // เรืองแสงรอบกรอบ (เส้นกว้างจางซ้อนกัน)
                drawRoundRect(frameColor.copy(alpha = 0.07f + 0.1f * glow), cornerRadius = CornerRadius(r), style = Stroke((8 + 8 * glow).dp.toPx()))
                drawRoundRect(frameColor.copy(alpha = 0.14f + 0.16f * glow), cornerRadius = CornerRadius(r), style = Stroke(4.dp.toPx()))
                drawRoundRect(
                    frameColor.copy(alpha = 0.95f),
                    topLeft = Offset(0.75.dp.toPx(), 0.75.dp.toPx()),
                    size = Size(w - 1.5.dp.toPx(), h - 1.5.dp.toPx()),
                    cornerRadius = CornerRadius(r),
                    style = Stroke(1.5.dp.toPx()),
                )
                // กรอบใน
                val i = 5.dp.toPx()
                drawRoundRect(
                    frameColor.copy(alpha = 0.25f),
                    topLeft = Offset(i, i),
                    size = Size(w - 2 * i, h - 2 * i),
                    cornerRadius = CornerRadius(1.5.dp.toPx()),
                    style = Stroke(1.dp.toPx()),
                )
                // มุมหนา
                val len = 12.dp.toPx()
                val cw = 2.5.dp.toPx()
                val c = J.HudHi
                corner(0f, 0f, 1f, 1f, len, c, cw)
                corner(w, 0f, -1f, 1f, len, c, cw)
                corner(0f, h, 1f, -1f, len, c, cw)
                corner(w, h, -1f, -1f, len, c, cw)
                // จุดชมพูที่มุมบน
                drawCircle(J.Rose, radius = 2.2.dp.toPx(), center = Offset(0f, 0f))
                drawCircle(J.Rose, radius = 2.2.dp.toPx(), center = Offset(w, 0f))
            }
            .padding(horizontal = padding, vertical = padding - 2.dp)
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                header.uppercase(),
                style = J.Label,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (label != null) {
                Text(label, style = J.Label.copy(color = J.Faint), modifier = Modifier.padding(horizontal = 6.dp))
            }
            headerTrailing()
        }
        Box(Modifier.padding(top = 6.dp, bottom = 8.dp).fillMaxWidth().height(1.dp).background(J.Hud.copy(alpha = 0.22f)))
        content()
    }
}

@Composable
fun HudDivider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(J.Hud.copy(alpha = 0.18f)))
}
