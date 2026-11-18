package com.smott.jarvis.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smott.jarvis.data.AppSettings
import com.smott.jarvis.core.keys.KeyService
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.runtime.mutableIntStateOf
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.smott.jarvis.ui.theme.J

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(
    current: AppSettings,
    onSave: (AppSettings) -> Unit,
    onClose: () -> Unit,
    deps: SettingsDeps = SettingsDeps(),
) {
    var s by remember(current) { mutableStateOf(current) }
    val context = LocalContext.current
    var geminiOrder by remember { mutableStateOf<List<String>>(emptyList()) }
    var geminiOk by remember { mutableStateOf(false) }
    LaunchedEffect(s.geminiKey, geminiOk) {
        geminiOrder = if (geminiOk) deps.geminiModels(s.geminiKey).getOrDefault(emptyList()) else emptyList()
    }
    BackHandler(onBack = onClose)

    Box(Modifier.fillMaxSize().background(J.Bg).blockTouches(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier
                .widthIn(max = 720.dp)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "ตั้งค่า",
                    style = TextStyle(fontFamily = J.Mono, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = J.Text),
                    modifier = Modifier.weight(1f),
                )
                SmallIcon(Icons.Rounded.Close, "ปิด", onClick = onClose)
            }
            Hint("ทุกบริการใส่แค่ API key — แอปตรวจให้ทันทีว่าใช้ได้ไหม (● เขียว = ใช้ได้) แตะ \"ขอคีย์ ↗\" เพื่อไปขอคีย์ฟรี")

            Section("สมอง (โมเดลภาษา)")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("Gemini — ฟรี", selected = s.llmProvider == AppSettings.PROVIDER_GEMINI) {
                    s = s.copy(llmProvider = AppSettings.PROVIDER_GEMINI)
                }
                Chip("OpenRouter", selected = s.llmProvider == AppSettings.PROVIDER_OPENROUTER) {
                    s = s.copy(llmProvider = AppSettings.PROVIDER_OPENROUTER)
                }
            }
            if (s.llmProvider == AppSettings.PROVIDER_GEMINI) {
                KeyField(
                    "Gemini API key", s.geminiKey, KeyService.GEMINI, deps.checkKey,
                    note = "ฟรีจาก Google AI Studio ไม่ต้องผูกบัตร",
                    onResult = { geminiOk = it?.ok == true },
                ) { s = s.copy(geminiKey = it) }
                if (geminiOrder.isNotEmpty()) {
                    Text("รุ่น", style = J.Small)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Chip("อัตโนมัติ (แนะนำ)", selected = s.geminiModel.isBlank()) { s = s.copy(geminiModel = "") }
                        geminiOrder.forEach { m -> Chip(m, selected = s.geminiModel == m) { s = s.copy(geminiModel = m) } }
                    }
                    Hint("อัตโนมัติ = เริ่มจากรุ่นใหม่สุด ถ้าไม่ว่างหรือโควตาเต็มจะสลับรุ่นถัดไปให้เอง · แผนฟรีของ Google อาจนำข้อความไปใช้ปรับปรุงบริการ")
                }
            } else {
                KeyField(
                    "OpenRouter API key", s.llmKey, KeyService.OPENROUTER, deps.checkKey,
                    note = "รุ่นฟรีใช้ได้ด้วยคีย์ฟรี (50 ครั้ง/วัน)",
                ) { s = s.copy(llmKey = it) }
                OpenRouterPicker(s.llmModel, deps.openRouterModels) { s = s.copy(llmModel = it) }
            }

            Section("ค้นเว็บ + หาคลิป")
            KeyField("Tavily API key", s.tavilyKey, KeyService.TAVILY, deps.checkKey, note = "ฟรี 1,000 เครดิต/เดือน ไม่ต้องผูกบัตร") {
                s = s.copy(tavilyKey = it)
            }

            Section("ข้อมูลตลาดหุ้น (ไม่ใส่ก็ได้)")
            KeyField("Finnhub API key (ราคา + ข่าว)", s.finnhubKey, KeyService.FINNHUB, deps.checkKey, note = "ฟรีสำหรับใช้ส่วนตัว") {
                s = s.copy(finnhubKey = it)
            }
            KeyField("Twelve Data API key (กราฟ)", s.twelveDataKey, KeyService.TWELVE_DATA, deps.checkKey, note = "ฟรี 800 ครั้ง/วัน") {
                s = s.copy(twelveDataKey = it)
            }

            Section("เสียง")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("th-TH" to "ไทย", "en-US" to "English").forEach { (tag, label) ->
                    Chip(label, selected = s.voiceLanguage == tag) { s = s.copy(voiceLanguage = tag) }
                }
            }
            SwitchRow("อ่านคำตอบออกเสียง เมื่อถามด้วยเสียง", s.speakAnswers) { s = s.copy(speakAnswers = it) }
            SwitchRow("โหมดสนทนา — อ่านจบแล้วฟังต่ออัตโนมัติ", s.conversationMode) { s = s.copy(conversationMode = it) }

            Section("ปลุกด้วยเสียง — \"Hey Jarvis\"")
            SwitchRow("พูด \"Hey Jarvis\" เพื่อเรียก (ฟังในเครื่อง ไม่ส่งเสียงออกไปไหน)", s.wakeEnabled) { s = s.copy(wakeEnabled = it) }
            SwitchRow("ฟังต่อแม้สลับไปแอปอื่น (มีการแจ้งเตือนค้างไว้)", s.wakeBackground) { s = s.copy(wakeBackground = it) }
            val sensitivity = ((0.8f - s.wakeThreshold) / 0.5f).coerceIn(0f, 1f)
            Text(
                "ความไว: " + when {
                    sensitivity > 0.75f -> "ไวมาก"
                    sensitivity > 0.45f -> "ปกติ"
                    else -> "เข้มงวด"
                },
                style = J.Body,
            )
            Slider(
                value = sensitivity,
                onValueChange = { v -> s = s.copy(wakeThreshold = 0.8f - 0.5f * v) },
                colors = SliderDefaults.colors(thumbColor = J.Accent, activeTrackColor = J.Accent, inactiveTrackColor = J.Line),
            )
            Hint("ไวมาก = เรียกติดง่ายแม้อยู่ไกล แต่อาจตื่นเองบ้าง · เข้มงวด = ต้องพูดชัด ๆ ใกล้ ๆ")
            SwitchRow("ถูกเรียกตอนจอล็อก: แสดง Jarvis บนหน้าล็อกเลย", s.wakeOverLock) { s = s.copy(wakeOverLock = it) }
            var resumes by remember { mutableIntStateOf(0) }
            LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { resumes++ }
            val canPop = remember(resumes) { runCatching { Settings.canDrawOverlays(context) }.getOrDefault(false) }
            val noDoze = remember(resumes) {
                runCatching {
                    context.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName) == true
                }.getOrDefault(false)
            }
            PermissionRow("เด้งขึ้นมาเหนือแอปอื่นเมื่อถูกเรียก", canPop) {
                runCatching {
                    context.startActivity(
                        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                }
            }
            PermissionRow("ไม่ให้ระบบปิด Jarvis เพื่อประหยัดแบต", noDoze) {
                runCatching {
                    context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            }
            Hint("Samsung: ตั้งค่า → การดูแลแบตเตอรี่ → ขีดจำกัดการใช้งานเบื้องหลัง → แอปที่ไม่เข้าสู่โหมดสลีป → เพิ่ม Jarvis · ถ้าเปิด \"Hi Bixby\" ไว้ ไมค์อาจถูกแย่งเป็นช่วง ๆ")

            Section("คลิปวิดีโอ")
            SwitchRow("เล่นคลิปในแผงอัตโนมัติ (ปิดเสียง)", s.autoplayVideos) { s = s.copy(autoplayVideos = it) }

            Hint("คีย์ทั้งหมดเข้ารหัสด้วย Android Keystore และเก็บไว้ในเครื่องนี้เท่านั้น")

            Spacer(Modifier.height(8.dp))
            Button(
                // ไม่มีช่องลิงก์ให้กรอกแล้ว — OpenRouter ใช้ที่อยู่มาตรฐานเสมอ
                onClick = { onSave(s.copy(llmBaseUrl = AppSettings.DEFAULT_BASE_URL)) },
                colors = ButtonDefaults.buttonColors(containerColor = J.Accent, contentColor = J.Bg),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                Text("บันทึก", style = TextStyle(fontFamily = J.Mono, fontSize = 15.sp, fontWeight = FontWeight.SemiBold))
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun Section(title: String) {
    Text(
        title,
        style = J.Label.copy(color = J.Accent),
        modifier = Modifier.padding(top = 12.dp),
    )
}

@Composable
private fun Hint(text: String) {
    Text(text, style = J.Small)
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = J.Body, modifier = Modifier.weight(1f))
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedThumbColor = J.Bg, checkedTrackColor = J.Accent),
        )
    }
}

@Composable
private fun PermissionRow(label: String, granted: Boolean, onOpen: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(enabled = !granted, onClick = onOpen).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = J.Body, modifier = Modifier.weight(1f))
        if (granted) {
            Text("✓ อนุญาตแล้ว", style = J.Small.copy(color = J.Up))
        } else {
            HudButton("อนุญาต", onClick = onOpen)
        }
    }
}
