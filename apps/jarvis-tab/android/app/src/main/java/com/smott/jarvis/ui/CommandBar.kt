package com.smott.jarvis.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smott.jarvis.ui.theme.J
import com.smott.jarvis.voice.MicState
import java.util.Locale

enum class OrbState { IDLE, LISTENING, THINKING, SPEAKING }

/** ช่องสั่งงานแบบบรรทัดคำสั่ง: › ถามอะไรก็ได้ (พูดได้โดยแตะลูกแก้วหรือกด Ctrl+J) */
@Composable
fun CommandBar(
    text: String,
    onText: (String) -> Unit,
    onSend: () -> Unit,
    mic: MicState,
    busy: Boolean,
    onStop: () -> Unit,
    focusRequester: FocusRequester,
    modifier: Modifier = Modifier,
) {
    val listening = mic as? MicState.Listening
    val shape = RoundedCornerShape(3.dp)
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clip(shape)
            .background(J.SurfaceHi.copy(alpha = 0.55f))
            .border(1.dp, if (listening != null) J.Rose.copy(alpha = 0.9f) else J.Hud.copy(alpha = 0.5f), shape)
            .padding(start = 14.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("›", style = TextStyle(fontFamily = J.Mono, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = J.Rose))
        Spacer(Modifier.width(10.dp))
        val hint = when {
            listening != null -> listening.partial.ifBlank { "กำลังฟัง…" }
            busy -> "กำลังค้นข้อมูล…"
            else -> "ถามอะไรก็ได้  ·  แตะลูกแก้วหรือ Ctrl+J เพื่อพูด"
        }
        BasicTextField(
            value = text,
            onValueChange = onText,
            textStyle = TextStyle(fontFamily = J.Mono, fontSize = 14.sp, color = J.Text),
            cursorBrush = SolidColor(J.Rose),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { onSend() }),
            maxLines = 4,
            modifier = Modifier
                .weight(1f)
                .padding(vertical = 11.dp)
                .focusRequester(focusRequester)
                .onPreviewKeyEvent { e ->
                    val enter = e.key == Key.Enter || e.key == Key.NumPadEnter
                    if (e.type == KeyEventType.KeyDown && enter && !e.isShiftPressed) {
                        onSend()
                        true
                    } else {
                        false
                    }
                },
            decorationBox = { inner ->
                Box {
                    if (text.isEmpty()) {
                        Text(
                            hint,
                            style = TextStyle(
                                fontFamily = J.Mono,
                                fontSize = 13.sp,
                                color = if (listening != null && listening.partial.isNotBlank()) J.Text else J.Faint,
                            ),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    inner()
                }
            },
        )
        when {
            busy -> SmallIcon(Icons.Rounded.Stop, "หยุด (Ctrl+.)", tint = J.Down, onClick = onStop)
            text.isNotBlank() -> SmallIcon(Icons.Rounded.ArrowUpward, "ส่ง", tint = J.Accent, onClick = onSend)
        }
    }
}

/**
 * มิเตอร์เสียงมุมซ้ายล่าง: แถบแดงแบ่งช่อง + LVL dB + ปุ่ม MUTE (ปิดเสียงอ่านคำตอบ)
 * ระดับเสียงมาจากไมค์ตอนกำลังฟัง (ค่าสัมพัทธ์ ไม่ใช่ dBFS จริง)
 */
@Composable
fun LevelMeter(
    level: Float,
    listening: Boolean,
    voiceOn: Boolean,
    onToggleVoice: () -> Unit,
    modifier: Modifier = Modifier,
    wakeDb: Float? = null,
    wakeLabel: String = "",
) {
    // ฟังคำสั่งอยู่ = ระดับจากตัวแปลงเสียง / ไม่ได้ฟัง = ระดับจริงจากไมค์ของระบบคำปลุก (มิเตอร์จึงขยับตลอดแบบในคลิป)
    val shown = when {
        listening -> level.coerceIn(0f, 1f)
        wakeDb != null -> ((wakeDb + 60f) / 60f).coerceIn(0f, 1f)
        else -> 0f
    }
    val db = if (!listening && wakeDb != null) wakeDb.coerceAtLeast(-90f) else -60f + 60f * shown
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Canvas(Modifier.size(width = 132.dp, height = 7.dp)) {
                val n = 24
                val gap = 2.dp.toPx()
                val w = (size.width - gap * (n - 1)) / n
                val lit = (shown * n).toInt()
                for (i in 0 until n) {
                    val on = i < lit
                    val hot = i >= (n * 0.75f).toInt()
                    val col = when {
                        on && hot -> J.HudHi
                        on -> J.Rose
                        else -> J.Rose.copy(alpha = 0.16f)
                    }
                    drawRect(col, Offset(i * (w + gap), 0f), Size(w, size.height))
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                val small = TextStyle(fontFamily = J.Mono, fontSize = 9.sp, letterSpacing = 0.6.sp, color = J.Muted)
                Text("LVL ${String.format(Locale.US, "%.1f", db)} dB", style = small)
                Text(if (voiceOn) "VOICE ON" else "VOICE OFF", style = small.copy(color = if (voiceOn) J.Muted else J.Rose))
                if (wakeLabel.isNotBlank()) Text(wakeLabel, style = small.copy(color = J.Accent))
            }
        }
        HudButton(if (voiceOn) "MUTE" else "UNMUTE", active = !voiceOn, onClick = onToggleVoice)
    }
}
