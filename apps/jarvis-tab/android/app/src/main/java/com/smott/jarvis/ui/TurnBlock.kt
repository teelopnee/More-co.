package com.smott.jarvis.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smott.jarvis.core.model.TraceStep
import com.smott.jarvis.core.model.Turn
import com.smott.jarvis.core.model.TurnStatus
import com.smott.jarvis.ui.panels.PanelEnv
import com.smott.jarvis.ui.panels.PanelGrid
import com.smott.jarvis.ui.theme.J
import kotlinx.coroutines.delay
import java.util.Locale

/** คำถาม 1 ข้อ: หัวคำถาม → แผง "RESEARCH // ACTIVE" (สด) → โมเสกแผงคำตอบ */
@Composable
fun TurnBlock(
    turn: Turn,
    number: Int,
    columns: Int,
    env: PanelEnv,
    onRetry: (String) -> Unit,
    onStop: () -> Unit,
) {
    var collapsed by rememberSaveable(turn.id) { mutableStateOf(false) }
    // แผงเล่นแอนิเมชันโผล่เข้ามาเฉพาะคำถามที่เพิ่งตอบเสร็จตรงหน้า ไม่เล่นซ้ำตอนเลื่อนกลับมาดู
    val live = remember { turn.status == TurnStatus.RUNNING }
    val animate = LocalAnimateIn.current && live
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TurnHeader(turn, number, collapsed, onToggle = { collapsed = !collapsed }, onRetry = onRetry, onStop = onStop)
        if (!collapsed) {
            when (turn.status) {
                TurnStatus.RUNNING -> PanelGrid(turn, columns, env, live = true)
                TurnStatus.FAILED, TurnStatus.CANCELLED ->
                    ErrorCard(turn.error ?: "เกิดข้อผิดพลาด", onRetry = { onRetry(turn.id) })
                TurnStatus.DONE -> {
                    CompositionLocalProvider(LocalAnimateIn provides animate) {
                        PanelGrid(turn, columns, env)
                    }
                    TraceSummary(turn)
                }
            }
        }
    }
}

@Composable
private fun TurnHeader(
    turn: Turn,
    number: Int,
    collapsed: Boolean,
    onToggle: () -> Unit,
    onRetry: (String) -> Unit,
    onStop: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(3.dp))
            .clickable(onClick = onToggle)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "QUERY ${String.format(Locale.US, "%02d", number)}",
            style = J.Label.copy(color = J.Rose),
            modifier = Modifier.padding(end = 12.dp),
        )
        Text(
            turn.question,
            style = TextStyle(fontFamily = J.Mono, fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Bold, color = J.Text),
            modifier = Modifier.weight(1f),
        )
        Text(clock(turn.askedAt), style = J.Small.copy(color = J.Faint), modifier = Modifier.padding(horizontal = 8.dp))
        when (turn.status) {
            TurnStatus.RUNNING -> SmallIcon(Icons.Rounded.Stop, "หยุด", tint = J.Down, onClick = onStop)
            TurnStatus.FAILED, TurnStatus.CANCELLED -> SmallIcon(Icons.Rounded.Refresh, "ลองใหม่") { onRetry(turn.id) }
            TurnStatus.DONE -> Unit
        }
        Icon(
            if (collapsed) Icons.Rounded.ExpandMore else Icons.Rounded.ExpandLess,
            contentDescription = if (collapsed) "ขยาย" else "ย่อ",
            tint = J.Faint,
            modifier = Modifier.size(20.dp),
        )
    }
}

private fun mmss(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return String.format(Locale.US, "%02d:%02d", s / 60, s % 60)
}

/**
 * แผง "RESEARCH // ACTIVE": ชื่อเรื่อง + ขั้นตอนที่กำลังทำ + แถบความคืบหน้าแบบแบ่งช่อง + จับเวลา
 * (ในวิดีโออ้างอิงคือแผงแรกที่โผล่มาตอนเริ่มค้น)
 */
@Composable
fun RunTile(turn: Turn, modifier: Modifier = Modifier) {
    val now by produceState(System.currentTimeMillis(), turn.id) {
        while (true) {
            value = System.currentTimeMillis()
            delay(1000)
        }
    }
    val steps = turn.trace
    val done = steps.count { it.done }
    val failed = steps.count { it.failed }
    val current = steps.lastOrNull { !it.done } ?: steps.lastOrNull()
    val line = current?.let { listOf(it.label, it.detail).filter(String::isNotBlank).joinToString(" · ") } ?: "กำลังเริ่ม"
    HudFrame(
        header = "RESEARCH // ACTIVE",
        modifier = modifier,
        headerTrailing = { Text(mmss(now - turn.askedAt), style = J.Label.copy(color = J.HudHi)) },
    ) {
        Text(
            turn.question.uppercase(),
            style = TextStyle(fontFamily = J.Mono, fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Bold, color = J.Text),
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(6.dp))
        Text(line.uppercase(), style = J.Small.copy(color = J.Muted), maxLines = 2, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(10.dp))
        SegmentBar(filled = done, total = 10, blinkNext = failed == 0 || done < steps.size)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            val blocks = turn.sources.count { it.videoId != null } + turn.images.size
            Text("$blocks BLOCKS", style = J.Label.copy(color = J.HudHi))
            Text("${turn.sources.size} SOURCES", style = J.Label.copy(color = J.HudHi))
            Text("$done STEPS", style = J.Label.copy(color = J.Muted))
            if (failed > 0) Text("$failed FAILED", style = J.Label.copy(color = J.Down))
        }
        Spacer(Modifier.height(4.dp))
        Text("STARTED ${clock(turn.askedAt)}", style = J.Small.copy(color = J.Faint, fontSize = 9.sp))
    }
}

@Composable
private fun SegmentBar(filled: Int, total: Int, blinkNext: Boolean) {
    val transition = rememberInfiniteTransition(label = "seg")
    val blink by transition.animateFloat(0.25f, 1f, infiniteRepeatable(tween(600), RepeatMode.Reverse), label = "blink")
    Canvas(Modifier.fillMaxWidth().height(6.dp)) {
        val gap = 3.dp.toPx()
        val w = (size.width - gap * (total - 1)) / total
        for (i in 0 until total) {
            val col = when {
                i < filled -> J.Accent
                i == filled && blinkNext -> J.Accent.copy(alpha = blink)
                else -> J.Hud.copy(alpha = 0.16f)
            }
            drawRect(col, Offset(i * (w + gap), 0f), Size(w, size.height))
        }
    }
}

@Composable
private fun TraceSummary(turn: Turn) {
    if (turn.trace.isEmpty()) return
    var open by rememberSaveable(turn.id + "_trace") { mutableStateOf(false) }
    Column {
        Text(
            "LOG // ${turn.trace.size} STEPS · ${turn.sources.size} NEW SOURCES  ${if (open) "▲" else "▼"}",
            style = J.Label.copy(color = J.Faint),
            modifier = Modifier
                .clip(RoundedCornerShape(3.dp))
                .clickable { open = !open }
                .padding(horizontal = 4.dp, vertical = 3.dp),
        )
        if (open) {
            Spacer(Modifier.height(6.dp))
            LogList(turn.trace)
        }
    }
}

@Composable
private fun LogList(steps: List<TraceStep>) {
    HudFrame(header = "LOG // STEPS", modifier = Modifier.widthIn(max = 520.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
            steps.forEach { step ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Dot(if (step.failed) J.Down else J.Accent.copy(alpha = 0.8f), size = 5.dp)
                    Spacer(Modifier.width(10.dp))
                    Text(step.label, style = TextStyle(fontFamily = J.Mono, fontSize = 12.sp, color = J.Text))
                    if (step.detail.isNotBlank()) {
                        Spacer(Modifier.width(8.dp))
                        Text(
                            step.detail,
                            style = J.Small.copy(color = J.Faint),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ErrorCard(message: String, onRetry: () -> Unit) {
    HudFrame(header = "ERROR // ผิดพลาด", accent = J.Down, modifier = Modifier.widthIn(max = 560.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(message, style = TextStyle(fontFamily = J.Mono, fontSize = 13.sp, lineHeight = 19.sp, color = J.Text), modifier = Modifier.weight(1f))
            Spacer(Modifier.width(10.dp))
            Chip("ลองใหม่", onClick = onRetry)
        }
    }
}
