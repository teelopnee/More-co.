package com.smott.jarvis.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smott.jarvis.core.keys.KeyCheck
import com.smott.jarvis.core.keys.KeyService
import com.smott.jarvis.core.llm.ModelCatalog
import com.smott.jarvis.ui.theme.J
import kotlinx.coroutines.delay
import java.util.Locale

/** สิ่งที่หน้าตั้งค่าใช้จากภายนอก (แยกไว้ให้วาดหน้าจอทดสอบได้โดยไม่ต้องมีเน็ต) */
class SettingsDeps(
    val checkKey: suspend (KeyService, String) -> KeyCheck = { _, _ -> KeyCheck(false, "") },
    /** รุ่น Gemini ที่จะใช้ตามลำดับ (จากรายชื่อสดของ Google) */
    val geminiModels: suspend (key: String) -> Result<List<String>> = { Result.success(emptyList()) },
    /** ทุกรุ่นบน OpenRouter ที่ใช้เครื่องมือได้ (ไม่ต้องใช้คีย์) */
    val openRouterModels: suspend () -> Result<List<ModelCatalog.Choice>> = { Result.success(emptyList()) },
)

/** ลิงก์ขอคีย์ของแต่ละเจ้า (แตะเปิดได้ ไม่ต้องพิมพ์อะไร) */
fun signupUrl(service: KeyService) = when (service) {
    KeyService.GEMINI -> "https://aistudio.google.com/apikey"
    KeyService.OPENROUTER -> "https://openrouter.ai/keys"
    KeyService.TAVILY -> "https://app.tavily.com"
    KeyService.FINNHUB -> "https://finnhub.io/register"
    KeyService.TWELVE_DATA -> "https://twelvedata.com/register"
}

private sealed interface KeyState {
    data object Empty : KeyState
    data object Checking : KeyState
    data class Done(val result: KeyCheck) : KeyState
}

/**
 * ช่องใส่คีย์ + ตรวจให้อัตโนมัติ (หยุดพิมพ์ 0.8 วินาที หรือตอนเปิดหน้าตั้งค่า) + ลิงก์ขอคีย์
 * ● เขียว = ใช้ได้ · ● แดง = ใช้ไม่ได้ พร้อมเหตุผล · ตรวจซ้ำได้ด้วยการแตะ "ตรวจอีกครั้ง"
 */
@Composable
fun KeyField(
    label: String,
    value: String,
    service: KeyService,
    check: suspend (KeyService, String) -> KeyCheck,
    note: String = "",
    onResult: (KeyCheck?) -> Unit = {},
    onChange: (String) -> Unit,
) {
    val context = LocalContext.current
    var visible by remember { mutableStateOf(false) }
    var state by remember { mutableStateOf(if (value.isBlank()) KeyState.Empty else KeyState.Checking) }
    var again by remember { mutableStateOf(0) }
    LaunchedEffect(value, again) {
        if (value.isBlank()) {
            state = KeyState.Empty
            onResult(null)
            return@LaunchedEffect
        }
        delay(800)
        state = KeyState.Checking
        val r = check(service, value)
        state = KeyState.Done(r)
        onResult(r)
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        OutlinedTextField(
            value = value,
            onValueChange = { onChange(it.trim()) },
            label = { Text(label) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            visualTransformation = if (!visible) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            trailingIcon = {
                SmallIcon(if (visible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, if (visible) "ซ่อน" else "แสดง") {
                    visible = !visible
                }
            },
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = J.Accent,
                unfocusedBorderColor = when ((state as? KeyState.Done)?.result?.ok) {
                    true -> J.Up.copy(alpha = 0.7f)
                    false -> J.Down.copy(alpha = 0.7f)
                    null -> J.Line
                },
                focusedTextColor = J.Text,
                unfocusedTextColor = J.Text,
                cursorColor = J.Accent,
                focusedLabelColor = J.Accent,
                unfocusedLabelColor = J.Muted,
            ),
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            val (dot, text, color) = when (val st = state) {
                KeyState.Empty -> Triple("○", note.ifBlank { "ยังไม่ได้ใส่คีย์" }, J.Faint)
                KeyState.Checking -> Triple("◌", "กำลังตรวจคีย์…", J.Muted)
                is KeyState.Done -> if (st.result.ok) Triple("●", st.result.message, J.Up) else Triple("●", st.result.message, J.Down)
            }
            Text("$dot ", style = J.Small.copy(color = color))
            Text(text, style = J.Small.copy(color = color), modifier = Modifier.weight(1f))
            if (state is KeyState.Done) {
                Text(
                    "ตรวจอีกครั้ง",
                    style = J.Small.copy(color = J.Accent),
                    modifier = Modifier.clip(RoundedCornerShape(3.dp)).clickable { again++ }.padding(horizontal = 6.dp),
                )
            }
            Text(
                "ขอคีย์ ↗",
                style = J.Small.copy(color = J.Accent),
                modifier = Modifier.clip(RoundedCornerShape(3.dp)).clickable { context.openExternal(signupUrl(service), newWindow = false) }
                    .padding(horizontal = 6.dp),
            )
        }
    }
}

private fun money(v: Double): String = when {
    v == 0.0 -> "0"
    v < 0.1 -> String.format(Locale.US, "%.3f", v)
    else -> String.format(Locale.US, "%.2f", v)
}

fun priceLabel(c: ModelCatalog.Choice): String =
    if (c.free) "ฟรี" else "$${money(c.inPerM)} / $${money(c.outPerM)}"

private enum class PickerTab(val label: String) { FREE("ฟรี"), LATEST("รุ่นล่าสุด (จ่ายตามใช้)"), ALL("ทั้งหมด") }

/**
 * เลือกโมเดล OpenRouter ด้วยการแตะ: แท็บ "ฟรี" / "รุ่นล่าสุด" (ชื่อ ~…-latest ชี้รุ่นใหม่สุดเสมอ) / "ทั้งหมด" (ค้นหาได้)
 * รายชื่อและราคามาจาก OpenRouter ตอนเปิดหน้านี้ — มีเฉพาะรุ่นที่เรียกเครื่องมือได้ (Jarvis ต้องใช้)
 */
@Composable
fun OpenRouterPicker(selected: String, load: suspend () -> Result<List<ModelCatalog.Choice>>, onPick: (String) -> Unit) {
    var all by remember { mutableStateOf<List<ModelCatalog.Choice>>(emptyList()) }
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var tab by remember { mutableStateOf(PickerTab.FREE) }
    var query by remember { mutableStateOf("") }
    var retry by remember { mutableStateOf(0) }
    LaunchedEffect(retry) {
        loading = true
        load().onSuccess { all = it; error = "" }.onFailure { error = "โหลดรายชื่อรุ่นไม่ได้: ${it.message?.take(100)}" }
        loading = false
        if (all.isNotEmpty() && all.none { it.id == selected && it.free }) tab = if (all.any { it.id == selected && it.latestAlias }) PickerTab.LATEST else tab
    }
    val current = all.firstOrNull { it.id == selected }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            "เลือกอยู่: " + (current?.let { "${it.name} · ${if (it.free) "ฟรี (50 ครั้ง/วัน ถ้ายังไม่เคยเติมเงิน)" else "จ่ายตามใช้ ${priceLabel(it)} ต่อ 1 ล้านโทเคน (เข้า/ออก)"}" } ?: selected),
            style = J.Small.copy(color = if (current?.free == true) J.Up else J.Text),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PickerTab.entries.forEach { t -> Chip(t.label, selected = tab == t) { tab = t } }
        }
        if (tab == PickerTab.ALL) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("ค้นหารุ่น เช่น claude, gpt, gemini, deepseek") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = J.Accent, unfocusedBorderColor = J.Line,
                    focusedTextColor = J.Text, unfocusedTextColor = J.Text, cursorColor = J.Accent,
                    focusedLabelColor = J.Accent, unfocusedLabelColor = J.Muted,
                ),
            )
        }
        when {
            loading -> Text("กำลังโหลดรายชื่อรุ่น…", style = J.Small)
            error.isNotBlank() -> Row(verticalAlignment = Alignment.CenterVertically) {
                Text(error, style = J.Small.copy(color = J.Down), modifier = Modifier.weight(1f))
                HudButton("ลองใหม่") { retry++ }
            }
            else -> {
                val list = when (tab) {
                    PickerTab.FREE -> all.filter { it.free }.sortedByDescending { it.context }
                    PickerTab.LATEST -> all.filter { it.latestAlias && !it.free }.sortedBy { it.inPerM + it.outPerM }
                    PickerTab.ALL -> all.filter { c ->
                        query.isBlank() || c.name.contains(query, ignoreCase = true) || c.id.contains(query, ignoreCase = true)
                    }.sortedBy { it.name.lowercase() }.take(60)
                }
                if (list.isEmpty()) Text("ไม่พบรุ่น", style = J.Small)
                list.forEach { c -> ModelRow(c, c.id == selected) { onPick(c.id) } }
                if (tab != PickerTab.FREE) Text("ราคาเป็นดอลลาร์ต่อ 1 ล้านโทเคน (ข้อความเข้า / ข้อความออก)", style = J.Small.copy(color = J.Faint))
            }
        }
    }
}

@Composable
private fun ModelRow(c: ModelCatalog.Choice, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(3.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (selected) J.Accent.copy(alpha = 0.14f) else J.SurfaceHi.copy(alpha = 0.5f))
            .border(1.dp, if (selected) J.Accent else J.Hud.copy(alpha = 0.25f), shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (selected) "◉" else "○", style = TextStyle(fontFamily = J.Mono, fontSize = 14.sp, color = if (selected) J.Accent else J.Faint))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(c.name, style = TextStyle(fontFamily = J.Mono, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = J.Text), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(c.id, style = J.Small.copy(fontSize = 10.sp, color = J.Faint), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.width(8.dp))
        Text(priceLabel(c), style = TextStyle(fontFamily = J.Mono, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (c.free) J.Up else J.Muted))
    }
}
