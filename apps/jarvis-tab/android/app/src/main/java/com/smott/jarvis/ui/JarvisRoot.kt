@file:OptIn(ExperimentalLayoutApi::class)

package com.smott.jarvis.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.coerceIn
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.lerp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.smott.jarvis.Detail
import com.smott.jarvis.MainViewModel
import com.smott.jarvis.core.model.Session
import com.smott.jarvis.core.model.Turn
import com.smott.jarvis.core.model.TurnStatus
import com.smott.jarvis.ui.panels.PanelEnv
import com.smott.jarvis.ui.theme.J
import com.smott.jarvis.voice.MicState
import com.smott.jarvis.wake.WakeStatus
import androidx.compose.animation.core.animateDpAsState
import kotlinx.coroutines.delay

private val SUGGESTIONS = listOf(
    "วิเคราะห์ตลาดหุ้นเทควันนี้ให้หน่อย",
    "ข่าว AI ที่สำคัญสัปดาห์นี้",
    "เทียบ NVDA กับ AMD ช่วง 6 เดือน",
    "ตั้งเวลา 25 นาที",
    "เปิด Samsung Notes",
)

/** การกระทำที่หน้าจอหลักเรียกใช้ (แยกออกมาเพื่อให้วาดหน้าจอโดยไม่ต้องมี ViewModel ได้) */
class WorkspaceActions(
    val ask: (String) -> Unit,
    val retry: (String) -> Unit,
    val stop: () -> Unit,
    val mic: () -> Unit,
    val history: () -> Unit,
    val newSession: () -> Unit,
    val settings: () -> Unit,
    val toggleVoice: () -> Unit,
    val closeDetail: () -> Unit,
    val setWide: (Boolean) -> Unit = {},
    val clearNotice: () -> Unit = {},
    val clearView: () -> Unit = {},
)

@Composable
fun JarvisRoot(vm: MainViewModel, onMic: () -> Unit) {
    val settingsOpen by vm.settingsOpen.collectAsStateWithLifecycle()
    val historyOpen by vm.historyOpen.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val sessions by vm.sessions.collectAsStateWithLifecycle()
    val session by vm.session.collectAsStateWithLifecycle()

    Box(
        Modifier
            .fillMaxSize()
            .hudBackground()
            .windowInsetsPadding(WindowInsets.safeDrawing)
    ) {
        Workspace(vm, onMic)
        if (historyOpen) {
            HistoryOverlay(
                sessions = sessions,
                currentId = session.id,
                onOpen = vm::openSession,
                onDelete = vm::deleteSession,
                onNew = vm::newSession,
                onClose = { vm.openHistory(false) },
            )
        }
        if (settingsOpen) {
            SettingsScreen(
                settings,
                onSave = vm::saveSettings,
                onClose = { vm.openSettings(false) },
                deps = remember(vm) {
                    SettingsDeps(checkKey = vm::checkKey, geminiModels = vm::geminiOrder, openRouterModels = vm::openRouterModels)
                },
            )
        }
    }
}

@Composable
private fun Workspace(vm: MainViewModel, onMic: () -> Unit) {
    val session by vm.session.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val mic by vm.mic.collectAsStateWithLifecycle()
    val speaking by vm.speaking.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val detail by vm.detail.collectAsStateWithLifecycle()
    val chartLoading by vm.chartLoading.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val focusTick by vm.focusInput.collectAsStateWithLifecycle()
    val hidden by vm.hidden.collectAsStateWithLifecycle()
    val tileFocus by vm.focus.collectAsStateWithLifecycle()
    // อ่านค่าแบบ lambda: มิเตอร์อัปเดต 4 ครั้ง/วินาที ให้วาดใหม่แค่มิเตอร์ ไม่ใช่ทั้งจอ
    val wakeState = vm.wakeStatus.collectAsStateWithLifecycle()
    val wakeFlash by vm.wakeFlash.collectAsStateWithLifecycle()

    val sourceMap = remember(session) { session.turns.flatMap { it.sources }.associateBy { it.id } }
    val env = remember(sourceMap, chartLoading, tileFocus, settings.autoplayVideos) {
        PanelEnv(
            source = { id -> sourceMap[id] },
            openSource = vm::openSource,
            openUrl = vm::openUrl,
            pin = vm::pin,
            changeRange = vm::changeRange,
            isChartLoading = { id -> id in chartLoading },
            ogImage = { url -> vm.ogImage(url) },
            focus = { turnId -> tileFocus?.takeIf { it.turnId == turnId }?.key },
            autoplayVideos = settings.autoplayVideos,
        )
    }
    val actions = remember(vm, onMic) {
        WorkspaceActions(
            ask = { q -> vm.ask(q) },
            retry = vm::retry,
            stop = vm::stop,
            mic = onMic,
            history = { vm.openHistory(true) },
            newSession = vm::newSession,
            settings = { vm.openSettings(true) },
            toggleVoice = vm::toggleVoice,
            closeDetail = vm::closeDetail,
            setWide = vm::setWideLayout,
            clearNotice = vm::clearNotice,
            clearView = vm::clearView,
        )
    }
    WorkspaceContent(
        session = session,
        busy = busy,
        mic = mic,
        speaking = speaking,
        voiceOn = settings.speakAnswers,
        detail = detail,
        notice = notice,
        focusTick = focusTick,
        env = env,
        actions = actions,
        hidden = hidden,
        wake = { wakeState.value },
        wakeFlash = wakeFlash,
    )
}

/** หน้าจอหลักแบบไม่ผูกกับ ViewModel: ลูกแก้ว + โมเสกแผง HUD + แถบเมนูมุมขวาบน + มิเตอร์/ช่องพิมพ์ด้านล่าง */
@Composable
fun WorkspaceContent(
    session: Session,
    busy: Boolean,
    mic: MicState,
    speaking: Boolean,
    voiceOn: Boolean,
    detail: Detail?,
    notice: String?,
    focusTick: Int,
    env: PanelEnv,
    actions: WorkspaceActions,
    playBoot: Boolean = true,
    hidden: Int = 0,
    wake: () -> WakeStatus = { WakeStatus.Off },
    wakeFlash: Int = 0,
) {
    val listState = rememberLazyListState()
    var input by rememberSaveable { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    val turns = remember(session.turns, hidden) { session.turns.drop(hidden.coerceAtMost(session.turns.size)) }
    val animateIn = LocalAnimateIn.current
    var booting by rememberSaveable { mutableStateOf(playBoot && animateIn) }

    val orb = when {
        mic is MicState.Listening -> OrbState.LISTENING
        busy -> OrbState.THINKING
        speaking -> OrbState.SPEAKING
        else -> OrbState.IDLE
    }
    val status: () -> String = {
        when (orb) {
            OrbState.LISTENING -> "LISTENING"
            OrbState.THINKING -> "SEARCHING"
            OrbState.SPEAKING -> "SPEAKING"
            OrbState.IDLE -> when (val w = wake()) {
                is WakeStatus.Listening -> if (w.micBusy) "STANDBY · MIC IN USE BY ANOTHER APP" else "STANDBY · SAY \"HEY JARVIS\""
                is WakeStatus.Failed -> "STANDBY · WAKE WORD OFF (${w.message})"
                WakeStatus.Loading -> "STANDBY · LOADING WAKE WORD"
                else -> "STANDBY"
            }
        }
    }
    val send: () -> Unit = {
        if (input.isNotBlank() && !busy) {
            actions.ask(input)
            input = ""
        }
    }
    val lastTurn = session.turns.lastOrNull()
    val followUps: List<String> =
        if (busy || lastTurn?.status != TurnStatus.DONE) emptyList() else lastTurn?.briefing?.followUps.orEmpty()

    LaunchedEffect(focusTick) { if (focusTick > 0) runCatching { focus.requestFocus() } }
    LaunchedEffect(Unit) {
        if (booting) {
            delay(2600)
            booting = false
        }
    }
    LaunchedEffect(notice) {
        if (notice != null) {
            delay(3_500)
            actions.clearNotice()
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val maxW = maxWidth
        val maxH = maxHeight
        val wide = maxW >= 1000.dp
        LaunchedEffect(wide) { actions.setWide(wide) }
        val sideWidth = (maxW * 0.38f).coerceIn(360.dp, 600.dp)
        val paneOpen = wide && detail != null

        // ลูกแก้ว: ว่าง = กลางจอใหญ่ ๆ / มีแผงบนจอ = ย่อไปมุมขวาล่าง
        val docked = turns.isNotEmpty() && !booting
        val dock by animateFloatAsState(
            if (docked) 1f else 0f,
            tween(if (LocalAnimateIn.current) 850 else 0, easing = FastOutSlowInEasing),
            label = "dock",
        )
        val big = minOf(maxW * 0.82f, maxH * 0.52f).coerceIn(190.dp, 360.dp)
        // ตอนถูกเรียก/กำลังฟัง ลูกแก้วที่มุมจอขยายใหญ่ขึ้นให้เห็นว่าพร้อมรับคำสั่ง
        val small by animateDpAsState(if (orb == OrbState.LISTENING) 150.dp else 96.dp, tween(400), label = "orb-small")
        val boardWidth = maxW - if (paneOpen) sideWidth else 0.dp
        val orbSize = lerp(big, small, dock)
        val orbX = lerp((boardWidth - big) / 2, boardWidth - small - 12.dp, dock)
        val orbY = lerp((maxH - big) / 2 - 36.dp, maxH - small - 4.dp, dock)
        val orbReserve = if (docked) small + 4.dp else 0.dp

        val columns = when {
            boardWidth >= 1280.dp -> 4
            boardWidth >= 900.dp -> 3
            boardWidth >= 560.dp -> 2
            else -> 1
        }

        Column(Modifier.fillMaxSize()) {
            HudBar(
                status = status,
                compact = maxW < 620.dp,
                canClear = turns.any { it.status != TurnStatus.RUNNING },
                onHistory = actions.history,
                onNew = actions.newSession,
                onClear = actions.clearView,
                onSettings = actions.settings,
            )
            Row(Modifier.weight(1f).fillMaxWidth()) {
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        if (turns.isEmpty()) {
                            EmptyHint(actions.ask, Modifier.align(Alignment.BottomCenter))
                        } else {
                            Feed(
                                turns = turns,
                                firstNumber = hidden.coerceAtMost(session.turns.size) + 1,
                                state = listState,
                                columns = columns,
                                env = env,
                                onRetry = actions.retry,
                                onStop = actions.stop,
                                bottomSpace = 64.dp,
                                modifier = Modifier.fillMaxSize(),
                            )
                        }
                    }
                    FollowUps(followUps, actions.ask)
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(start = 16.dp, end = 16.dp + orbReserve, top = 8.dp, bottom = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (maxW >= 720.dp) {
                            WakeMeter(mic, voiceOn, actions.toggleVoice, wake)
                            Spacer(Modifier.width(18.dp))
                        }
                        CommandBar(
                            text = input,
                            onText = { input = it },
                            onSend = send,
                            mic = mic,
                            busy = busy,
                            onStop = actions.stop,
                            focusRequester = focus,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
                if (wide && detail != null) {
                    VLine()
                    DetailPane(detail, session, env, onClose = actions.closeDetail, modifier = Modifier.width(sideWidth).fillMaxHeight())
                }
            }
        }

        ReactorOrb(
            state = orb,
            level = (mic as? MicState.Listening)?.level ?: 0f,
            name = "JARVIS",
            booting = booting,
            flash = wakeFlash,
            onClick = if (booting) null else actions.mic,
            modifier = Modifier.offset(orbX, orbY).size(orbSize),
        )

        if (!wide && detail != null) {
            DetailPane(detail, session, env, onClose = actions.closeDetail, modifier = Modifier.fillMaxSize())
        }
        notice?.let { message ->
            Text(
                message,
                style = TextStyle(fontFamily = J.Mono, fontSize = 12.sp, color = J.Text),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 96.dp, start = 24.dp, end = 24.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(J.SurfaceHi)
                    .border(1.dp, J.Hud.copy(alpha = 0.7f), RoundedCornerShape(3.dp))
                    .padding(horizontal = 16.dp, vertical = 10.dp),
            )
        }
    }
}

/** แถบเมนูมุมขวาบน: ตัวเล็กกรอบขาวแบบ HUD */
@Composable
private fun WakeMeter(mic: MicState, voiceOn: Boolean, onToggleVoice: () -> Unit, wake: () -> WakeStatus) {
    val w = wake()
    LevelMeter(
        level = (mic as? MicState.Listening)?.level ?: 0f,
        listening = mic is MicState.Listening,
        voiceOn = voiceOn,
        onToggleVoice = onToggleVoice,
        wakeDb = (w as? WakeStatus.Listening)?.levelDb,
        wakeLabel = when (w) {
            is WakeStatus.Listening -> "WAKE ON"
            is WakeStatus.Paused -> "WAKE PAUSED"
            is WakeStatus.Failed -> "WAKE ERROR"
            else -> ""
        },
    )
}

@Composable
private fun HudBar(
    status: () -> String,
    compact: Boolean,
    canClear: Boolean,
    onHistory: () -> Unit,
    onNew: () -> Unit,
    onClear: () -> Unit,
    onSettings: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(start = 16.dp, end = 12.dp, top = 10.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Dot(J.Rose, size = 6.dp)
        Spacer(Modifier.width(8.dp))
        if (!compact) Text("JARVIS // ${status()}", style = J.Label.copy(color = J.Muted), maxLines = 1)
        Spacer(Modifier.weight(1f))
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            HudButton("History", onClick = onHistory)
            HudButton("New", onClick = onNew)
            HudButton("Clear view", enabled = canClear, onClick = onClear)
            HudButton("Settings", onClick = onSettings)
        }
    }
}

@Composable
private fun Feed(
    turns: List<Turn>,
    firstNumber: Int,
    state: LazyListState,
    columns: Int,
    env: PanelEnv,
    onRetry: (String) -> Unit,
    onStop: () -> Unit,
    bottomSpace: androidx.compose.ui.unit.Dp,
    modifier: Modifier,
) {
    // มีคำถามใหม่ → เลื่อนไปที่คำถามนั้น (คำตอบเก่ายังอยู่ด้านบน เลื่อนขึ้นไปดูได้)
    LaunchedEffect(turns.size) {
        if (turns.isNotEmpty()) state.animateScrollToItem(turns.lastIndex)
    }
    LazyColumn(
        state = state,
        modifier = modifier,
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = bottomSpace),
        verticalArrangement = Arrangement.spacedBy(26.dp),
    ) {
        itemsIndexed(turns, key = { _, t -> t.id }) { i, turn ->
            TurnBlock(turn, firstNumber + i, columns, env, onRetry, onStop)
        }
    }
}

/** หน้าว่าง: ลูกแก้วอยู่กลางจอ ข้างล่างมีคำถามตัวอย่างจาง ๆ */
@Composable
private fun EmptyHint(onAsk: (String) -> Unit, modifier: Modifier) {
    Column(
        modifier.padding(horizontal = 24.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "ONLINE // ถามอะไรก็ได้",
            style = J.Label.copy(color = J.Faint, textAlign = TextAlign.Center),
        )
        Spacer(Modifier.height(10.dp))
        FlowRow(
            modifier = Modifier.widthIn(max = 720.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SUGGESTIONS.forEach { s -> Chip(s) { onAsk(s) } }
        }
    }
}

@Composable
private fun FollowUps(items: List<String>, onAsk: (String) -> Unit) {
    if (items.isEmpty()) return
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("NEXT //", style = J.Label.copy(color = J.Rose))
        items.forEach { q -> Chip(q) { onAsk(q) } }
    }
}

@Composable
private fun HistoryOverlay(
    sessions: List<Session>,
    currentId: String,
    onOpen: (String) -> Unit,
    onDelete: (String) -> Unit,
    onNew: () -> Unit,
    onClose: () -> Unit,
) {
    BackHandler(onBack = onClose)
    Column(Modifier.fillMaxSize().hudBackground().blockTouches()) {
        Row(
            Modifier.fillMaxWidth().height(56.dp).padding(start = 20.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "HISTORY // ประวัติ",
                style = TextStyle(fontFamily = J.Mono, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = J.Text),
                modifier = Modifier.weight(1f),
            )
            SmallIcon(Icons.Rounded.Close, "ปิด", onClick = onClose)
        }
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            item {
                Box(Modifier.padding(bottom = 8.dp)) { Chip("＋  เซสชันใหม่", onClick = onNew) }
            }
            items(sessions, key = { it.id }) { s ->
                val current = s.id == currentId
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(3.dp))
                        .background(if (current) J.Hud.copy(alpha = 0.10f) else J.Surface)
                        .border(1.dp, if (current) J.Hud.copy(alpha = 0.8f) else J.Line, RoundedCornerShape(3.dp))
                        .clickable { onOpen(s.id) }
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            s.title.ifBlank { "ไม่มีชื่อ" },
                            style = TextStyle(fontFamily = J.Mono, fontSize = 14.sp, color = J.Text),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text("${dayLabel(s.createdAt)} · ${s.turns.size} คำถาม", style = J.Small)
                    }
                    SmallIcon(Icons.Outlined.DeleteOutline, "ลบ", tint = J.Faint) { onDelete(s.id) }
                }
            }
        }
    }
}
