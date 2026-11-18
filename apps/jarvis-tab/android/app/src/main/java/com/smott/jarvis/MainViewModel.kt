package com.smott.jarvis

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.smott.jarvis.core.ConfigException
import com.smott.jarvis.core.llm.LlmException
import com.smott.jarvis.core.model.ChartRange
import com.smott.jarvis.core.model.Session
import com.smott.jarvis.core.model.Turn
import com.smott.jarvis.core.model.TurnStatus
import com.smott.jarvis.core.net.HttpError
import com.smott.jarvis.core.net.resultOf
import com.smott.jarvis.core.voice.VoiceCommand
import com.smott.jarvis.core.keys.KeyCheck
import com.smott.jarvis.core.keys.KeyService
import com.smott.jarvis.core.llm.ModelCatalog
import com.smott.jarvis.core.voice.VoiceCommands
import com.smott.jarvis.data.AppSettings
import com.smott.jarvis.ui.narration
import com.smott.jarvis.ui.panels.PanelKind
import com.smott.jarvis.voice.MicState
import com.smott.jarvis.wake.WakeService
import com.smott.jarvis.wake.WakeStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.InterruptedIOException
import java.net.UnknownHostException
import java.util.UUID

/** สิ่งที่แสดงในแผงด้านข้าง: หน้าเว็บ หรือแผงคำตอบที่ปักไว้ */
sealed interface Detail {
    data class Web(val url: String, val title: String) : Detail
    data class Pinned(val turnId: String, val kind: PanelKind) : Detail
}

/** แผงที่กำลังถูกอธิบายด้วยเสียง (ไฮไลต์บนจอ) */
data class TileFocus(val turnId: String, val key: String)

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val c = (app as JarvisApp).container

    val settings: StateFlow<AppSettings> = c.settings.state
    val mic: StateFlow<MicState> = c.speech.state
    val speaking: StateFlow<Boolean> = c.speaker.speaking
    val wakeStatus: StateFlow<WakeStatus> = c.wake.status

    private val _session = MutableStateFlow(blankSession())
    val session: StateFlow<Session> = _session.asStateFlow()

    private val _sessions = MutableStateFlow<List<Session>>(emptyList())
    val sessions: StateFlow<List<Session>> = _sessions.asStateFlow()

    private val _detail = MutableStateFlow<Detail?>(null)
    val detail: StateFlow<Detail?> = _detail.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _chartLoading = MutableStateFlow<Set<String>>(emptySet())
    val chartLoading: StateFlow<Set<String>> = _chartLoading.asStateFlow()

    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    private val _settingsOpen = MutableStateFlow(false)
    val settingsOpen: StateFlow<Boolean> = _settingsOpen.asStateFlow()

    private val _historyOpen = MutableStateFlow(false)
    val historyOpen: StateFlow<Boolean> = _historyOpen.asStateFlow()

    private val _focusInput = MutableStateFlow(0)
    val focusInput: StateFlow<Int> = _focusInput.asStateFlow()

    /** นับครั้งที่ถูกปลุก — ลูกแก้วใช้เล่นแสงวาบ */
    private val _wakeFlash = MutableStateFlow(0)
    val wakeFlash: StateFlow<Int> = _wakeFlash.asStateFlow()

    /** ซ่อนคำถามก่อนหน้าจากจอ (CLEAR VIEW) โดยไม่ลบประวัติ */
    private val _hidden = MutableStateFlow(0)
    val hidden: StateFlow<Int> = _hidden.asStateFlow()

    private val _focus = MutableStateFlow<TileFocus?>(null)
    val focus: StateFlow<TileFocus?> = _focus.asStateFlow()

    private var job: Job? = null
    private var holdWatchdog: Job? = null
    private var walkSteps: List<Pair<String, String>> = emptyList()
    private var walkTurn: String? = null
    private var walkIndex = 0

    private var visible = false
    private var micGranted = false

    init {
        viewModelScope.launch {
            c.sessions.latest()?.let { _session.value = it.recovered() }
            refreshSessions()
            if (settings.value.activeLlmKey.isBlank()) _settingsOpen.value = true
        }
        viewModelScope.launch { c.wake.wakes.collect { onWake() } }
        viewModelScope.launch {
            settings.collect { s ->
                c.wake.threshold = s.wakeThreshold
                syncWake()
            }
        }
    }

    // ---------- คำปลุก ----------

    /** Activity แจ้งว่าแอปอยู่บนจอไหม และได้สิทธิ์ไมค์หรือยัง */
    fun onVisibility(visible: Boolean, micGranted: Boolean) {
        this.visible = visible
        this.micGranted = micGranted
        c.wake.appVisible = visible
        syncWake()
    }

    private fun syncWake() {
        val s = settings.value
        val want = s.wakeEnabled && micGranted && (visible || s.wakeBackground)
        val app = getApplication<Application>()
        if (want) {
            // Android ให้เริ่มฟังไมค์แบบ foreground service ได้เฉพาะตอนแอปอยู่บนจอ
            if (visible && !c.wake.running) WakeService.start(app)
        } else {
            WakeService.stop(app)
        }
    }

    /** ได้ยิน "Hey Jarvis": วาบลูกแก้ว → ทักทาย → ฟังคำสั่ง */
    fun onWake() {
        if (c.speech.isListening) return
        stopWalkthrough()
        c.speaker.stop()
        _wakeFlash.update { it + 1 }
        holdMic()
        val s = settings.value
        if (s.speakAnswers) {
            c.speaker.speak(greeting(s.voiceLanguage), s.voiceLanguage) { listenNow() }
        } else {
            listenNow()
        }
    }

    private fun greeting(lang: String): String =
        if (lang.startsWith("th")) listOf("ครับ", "ว่าไงครับ", "ครับ ผมฟังอยู่", "ครับผม มีอะไรให้ช่วยครับ").random()
        else listOf("Yes?", "I'm listening.", "Yes, boss?").random()

    /** พักระบบคำปลุก (คืนไมค์ให้ตัวแปลงเสียง) พร้อมตัวกันค้าง: ถ้าไม่ได้ฟังจริงภายใน 25 วินาที คืนไมค์เอง */
    private fun holdMic() {
        c.wake.hold(HOLD_LISTEN)
        holdWatchdog?.cancel()
        holdWatchdog = viewModelScope.launch {
            delay(25_000)
            if (!c.speech.isListening) c.wake.release(HOLD_LISTEN)
        }
    }

    private fun listenNow() {
        holdMic()
        c.speech.start(
            settings.value.voiceLanguage,
            onResult = { text -> handleVoice(text) },
            onEnd = {
                holdWatchdog?.cancel()
                c.wake.release(HOLD_LISTEN)
            },
        )
    }

    /** ข้อความจากเสียง: คำสั่งสั้น ๆ ทำเองทันที นอกนั้นส่งให้ผู้ช่วยค้นคำตอบ */
    fun handleVoice(text: String) {
        when (val cmd = VoiceCommands.parse(text)) {
            VoiceCommand.Stop -> stop()
            VoiceCommand.ClearView -> clearView()
            VoiceCommand.NewSession -> newSession()
            VoiceCommand.Walkthrough -> if (!walkthrough()) ask(text, fromVoice = true)
            VoiceCommand.Mute -> setVoice(false)
            VoiceCommand.Unmute -> setVoice(true).also { say("เปิดเสียงแล้วครับ") }
            VoiceCommand.Repeat -> repeatLast()
            VoiceCommand.Nothing -> Unit
            is VoiceCommand.Ask -> {
                if (_busy.value) {
                    // ถามเรื่องใหม่ระหว่างที่กำลังค้นเรื่องเก่า → หยุดเรื่องเก่าแล้วทำเรื่องใหม่
                    val old = job
                    viewModelScope.launch {
                        old?.cancelAndJoin()
                        ask(cmd.text, fromVoice = true)
                    }
                } else {
                    ask(cmd.text, fromVoice = true)
                }
            }
        }
    }

    private fun say(text: String, onDone: (() -> Unit)? = null) {
        val s = settings.value
        if (s.speakAnswers) c.speaker.speak(text, s.voiceLanguage, onDone) else onDone?.invoke()
    }

    private fun repeatLast() {
        val last = _session.value.turns.lastOrNull { it.status == TurnStatus.DONE }?.briefing?.spoken
        if (last.isNullOrBlank()) say("ยังไม่มีคำตอบให้พูดซ้ำครับ") else c.speaker.speak(last, settings.value.voiceLanguage)
    }

    // ---------- อธิบายทีละแผง ("อธิบายให้ฟัง" / "walk me through it") ----------

    fun walkthrough(): Boolean {
        val turn = _session.value.turns.lastOrNull { it.status == TurnStatus.DONE && it.briefing != null } ?: return false
        val steps = narration(turn)
        if (steps.isEmpty()) return false
        c.speaker.stop()
        walkTurn = turn.id
        walkSteps = steps
        walkIndex = 0
        speakStep()
        return true
    }

    private fun speakStep() {
        val turnId = walkTurn ?: return
        val step = walkSteps.getOrNull(walkIndex)
        if (step == null) {
            stopWalkthrough()
            return
        }
        _focus.value = TileFocus(turnId, step.first)
        c.speaker.speak(step.second, settings.value.voiceLanguage) {
            walkIndex++
            speakStep()
        }
    }

    private fun stopWalkthrough() {
        walkSteps = emptyList()
        walkTurn = null
        _focus.value = null
    }

    // ---------- ถาม-ตอบ ----------

    fun ask(raw: String, fromVoice: Boolean = false) {
        val question = raw.trim()
        if (question.isEmpty()) return
        if (_busy.value) {
            notify("กำลังตอบคำถามก่อนหน้าอยู่ — กดหยุดก่อนถ้าต้องการถามใหม่")
            return
        }
        stopWalkthrough()
        c.speaker.stop()

        val history = _session.value.turns.filter { it.status == TurnStatus.DONE }
        val turn = Turn(id = newId(), question = question, askedAt = System.currentTimeMillis())
        _session.update { s -> s.copy(title = s.title.ifBlank { question.take(60) }, turns = s.turns + turn) }
        pinPreviousForFollowUp(history)
        _busy.value = true

        job = viewModelScope.launch {
            try {
                c.ensureModel()
                val result = c.agent.run(
                    question,
                    history,
                    onProgress = { sources, images ->
                        // แผงทยอยขึ้นระหว่างค้น (ที่มา/คลิป/ภาพ)
                        updateTurn(turn.id) { if (it.status == TurnStatus.RUNNING) it.copy(sources = sources, images = images) else it }
                    },
                ) { steps ->
                    updateTurn(turn.id) { it.copy(trace = steps) }
                }
                updateTurn(turn.id) {
                    it.copy(
                        status = TurnStatus.DONE,
                        briefing = result.briefing,
                        sources = result.newSources,
                        quotes = result.quotes,
                        series = result.series,
                        images = result.images,
                    )
                }
                val s = settings.value
                if (fromVoice && s.speakAnswers) {
                    c.speaker.speak(result.briefing.spoken, s.voiceLanguage) {
                        if (settings.value.conversationMode && !_busy.value) listenNow()
                    }
                }
            } catch (e: CancellationException) {
                updateTurn(turn.id) { it.copy(status = TurnStatus.CANCELLED, error = "หยุดแล้ว") }
                throw e
            } catch (e: Exception) {
                updateTurn(turn.id) { it.copy(status = TurnStatus.FAILED, error = friendlyError(e)) }
                if (fromVoice) say("ขอโทษครับ ${friendlyError(e)}")
            } finally {
                _busy.value = false
                withContext(NonCancellable) { persist() }
            }
        }
    }

    fun stop() {
        job?.cancel()
        stopWalkthrough()
        c.speaker.stop()
        c.speech.cancel()
    }

    fun retry(turnId: String) {
        val turn = _session.value.turns.firstOrNull { it.id == turnId } ?: return
        if (_busy.value) return
        _session.update { s -> s.copy(turns = s.turns.filterNot { it.id == turnId }) }
        ask(turn.question)
    }

    /** หน้าจอกว้างพอจะมีแผงด้านข้างหรือไม่ (UI แจ้งเข้ามาเมื่อย่อ/ขยายหน้าต่าง) */
    @Volatile
    private var wideLayout = false

    fun setWideLayout(wide: Boolean) {
        wideLayout = wide
    }

    /** ถามต่อบนจอใหญ่: ปักแผงหลักของคำตอบก่อนหน้าไว้ด้านข้าง ข้อมูลเดิมจึงยังอยู่บนจอ */
    private fun pinPreviousForFollowUp(history: List<Turn>) {
        if (!wideLayout || _detail.value != null) return
        val prev = history.lastOrNull()?.takeIf { it.briefing != null } ?: return
        if (prev.id in _session.value.turns.take(_hidden.value).map { it.id }) return
        val kind = if (prev.briefing?.chart != null && prev.series.isNotEmpty()) PanelKind.CHART else PanelKind.OVERVIEW
        _detail.value = Detail.Pinned(prev.id, kind)
    }

    // ---------- เสียง (แตะลูกแก้ว / Ctrl+J) ----------

    fun toggleMic() {
        if (mic.value is MicState.Listening) c.speech.stop() else startListening()
    }

    private fun startListening() {
        stopWalkthrough()
        c.speaker.stop()
        listenNow()
    }

    fun isListening(): Boolean = c.speech.isListening

    /** ปุ่ม MUTE: เปิด/ปิดเสียงอ่านคำตอบ (ไม่กระทบการฟังคำสั่ง) */
    fun toggleVoice() = setVoice(!settings.value.speakAnswers)

    private fun setVoice(on: Boolean) {
        c.settings.update { it.copy(speakAnswers = on) }
        if (!on) c.speaker.stop()
        notify(if (on) "เปิดเสียงอ่านคำตอบแล้ว" else "ปิดเสียงอ่านคำตอบแล้ว")
    }

    // ---------- กราฟ ----------

    fun changeRange(turnId: String, range: ChartRange) {
        val turn = _session.value.turns.firstOrNull { it.id == turnId } ?: return
        val chart = turn.briefing?.chart ?: return
        if (turnId in _chartLoading.value) return
        viewModelScope.launch {
            _chartLoading.update { it + turnId }
            try {
                val missing = chart.symbols.filter { s -> turn.series.none { it.symbol == s && it.range == range } }
                val fetched = missing.map { s -> async { resultOf { c.market.history(s, range) }.getOrNull() } }
                    .awaitAll().filterNotNull()
                if (missing.isNotEmpty() && fetched.isEmpty()) {
                    notify(if (c.market.historyAvailable) "ดึงกราฟช่วง ${range.label} ไม่สำเร็จ" else "ต้องใส่ Twelve Data key ก่อน")
                    return@launch
                }
                updateTurn(turnId) { t ->
                    val kept = t.series.filterNot { s -> fetched.any { it.symbol == s.symbol && it.range == s.range } }
                    t.copy(
                        series = kept + fetched,
                        briefing = t.briefing?.copy(chart = chart.copy(range = range.label)),
                    )
                }
                persist()
            } finally {
                _chartLoading.update { it - turnId }
            }
        }
    }

    // ---------- แผงด้านข้าง ----------

    fun openSource(id: String) {
        val source = _session.value.turns.asSequence().flatMap { it.sources }.firstOrNull { it.id == id } ?: return
        openUrl(source.url, source.title)
    }

    fun openUrl(url: String, title: String) {
        _detail.value = Detail.Web(url, title)
    }

    fun pin(turnId: String, kind: PanelKind) {
        _detail.value = Detail.Pinned(turnId, kind)
    }

    fun closeDetail() {
        _detail.value = null
    }

    // ---------- เซสชัน ----------

    fun clearView() {
        _hidden.value = _session.value.turns.count { it.status != TurnStatus.RUNNING }
        _detail.value = null
        stopWalkthrough()
    }

    fun newSession() {
        if (_busy.value) stop()
        stopWalkthrough()
        _session.value = blankSession()
        _hidden.value = 0
        _detail.value = null
        _historyOpen.value = false
        viewModelScope.launch { refreshSessions() }
    }

    fun openSession(id: String) {
        if (_busy.value) return
        viewModelScope.launch {
            c.sessions.load(id)?.let {
                _session.value = it.recovered()
                _hidden.value = 0
                _detail.value = null
                stopWalkthrough()
            }
            _historyOpen.value = false
        }
    }

    fun deleteSession(id: String) {
        viewModelScope.launch {
            c.sessions.delete(id)
            if (_session.value.id == id) {
                _session.value = blankSession()
                _hidden.value = 0
            }
            refreshSessions()
        }
    }

    fun openHistory(open: Boolean) {
        _historyOpen.value = open
    }

    // ---------- ตั้งค่า / อื่น ๆ ----------

    fun openSettings(open: Boolean) {
        _settingsOpen.value = open
    }

    fun saveSettings(next: AppSettings) {
        c.settings.update { next }
        _settingsOpen.value = false
        notify("บันทึกการตั้งค่าแล้ว")
    }

    fun requestInputFocus() {
        _focusInput.update { it + 1 }
    }

    fun notify(message: String) {
        _notice.value = message
    }

    fun clearNotice() {
        _notice.value = null
    }

    suspend fun ogImage(url: String): String? = c.ogImage(url)

    suspend fun checkKey(service: KeyService, key: String): KeyCheck = c.keys.check(service, key)

    suspend fun geminiOrder(key: String): Result<List<String>> = resultOf { c.geminiOrder(key) }

    suspend fun openRouterModels(): Result<List<ModelCatalog.Choice>> = resultOf { c.openRouterChoices() }

    override fun onCleared() {
        c.speech.cancel()
        c.speaker.stop()
        c.wake.release(HOLD_LISTEN)
        super.onCleared()
    }

    // ---------- ภายใน ----------

    private fun updateTurn(id: String, change: (Turn) -> Turn) {
        _session.update { s -> s.copy(turns = s.turns.map { if (it.id == id) change(it) else it }) }
    }

    private suspend fun persist() {
        runCatching { c.sessions.save(_session.value) }
        refreshSessions()
    }

    private suspend fun refreshSessions() {
        _sessions.value = runCatching { c.sessions.list() }.getOrDefault(emptyList())
    }

    private fun blankSession() = Session(id = newId(), createdAt = System.currentTimeMillis())

    private fun newId() = UUID.randomUUID().toString()

    /** คำถามที่ค้างอยู่ตอนแอปถูกปิด ให้ขึ้นเป็น "ถูกขัดจังหวะ" กดลองใหม่ได้ */
    private fun Session.recovered(): Session = copy(
        turns = turns.map {
            if (it.status == TurnStatus.RUNNING) it.copy(status = TurnStatus.FAILED, error = "ถูกขัดจังหวะ — กดลองใหม่ได้") else it
        }
    )

    private fun friendlyError(e: Exception): String = when (e) {
        is ConfigException -> e.message.orEmpty()
        is HttpError -> when (e.code) {
            401, 403 -> if (e.body.contains("suspended", ignoreCase = true)) {
                "โปรเจกต์ Google ของคีย์นี้ถูกระงับ — สร้างคีย์ใหม่ (โปรเจกต์ใหม่) ที่ aistudio.google.com แล้วใส่ในหน้าตั้งค่า"
            } else {
                "คีย์ API ของ ${e.host} ไม่ถูกต้องหรือไม่มีสิทธิ์ — ตรวจในหน้าตั้งค่า"
            }
            402 -> "เครดิตของ ${e.host} หมด"
            404 -> "ไม่พบปลายทางที่ ${e.host} — ตรวจ Base URL / ชื่อโมเดลในหน้าตั้งค่า"
            429 -> if (e.body.contains("quota", ignoreCase = true) || e.body.contains("per day", ignoreCase = true)) {
                "โควตาฟรีของ ${e.host} หมดแล้ว (รีเซ็ตทุกวัน/ทุกนาที) รอสักครู่หรือลองพรุ่งนี้"
            } else {
                "${e.host} จำกัดจำนวนครั้งต่อนาที รอสักครู่แล้วลองใหม่"
            }
            in 500..599 -> "${e.host} ขัดข้องชั่วคราว ลองใหม่อีกครั้ง"
            else -> "ข้อผิดพลาดจาก ${e.host} (${e.code})"
        }
        is UnknownHostException -> "ไม่มีอินเทอร์เน็ต"
        is InterruptedIOException -> "เครือข่ายช้าเกินไป ลองใหม่อีกครั้ง"
        is LlmException -> e.message.orEmpty()
        else -> e.message ?: e.javaClass.simpleName
    }

    private companion object {
        const val HOLD_LISTEN = "listen"
    }
}
