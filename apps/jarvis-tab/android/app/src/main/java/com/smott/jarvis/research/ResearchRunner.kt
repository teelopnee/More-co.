package com.smott.jarvis.research

import android.content.Context
import android.os.PowerManager
import com.smott.jarvis.core.agent.Agent
import com.smott.jarvis.core.model.Session
import com.smott.jarvis.core.model.TraceStep
import com.smott.jarvis.core.model.Turn
import com.smott.jarvis.core.model.TurnStatus
import com.smott.jarvis.data.SessionStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

/** ผลของคำถาม 1 ครั้ง (ViewModel ใช้พูดคำตอบเมื่อถามด้วยเสียง) */
data class Finished(val turnId: String, val fromVoice: Boolean, val spoken: String?, val error: String?)

/** สิ่งที่แสดงในการแจ้งเตือนระหว่างค้น */
data class Progress(val question: String, val startedAt: Long, val step: String, val sources: Int)

/**
 * งานค้นคำตอบและบทสนทนาปัจจุบัน — อยู่ระดับแอป (ไม่ผูกกับหน้าจอ)
 * ปิดหน้าจอ/สลับแอป/ปัดแอปทิ้ง งานก็ยังค้นต่อ: มี foreground service ([ResearchService]) กันระบบปิดแอป
 * และ wake lock กัน CPU หลับตอนจอดับ เสร็จแล้วแจ้งเตือนถ้าแอปไม่ได้อยู่บนจอ
 */
class ResearchRunner(
    context: Context,
    private val agent: Agent,
    private val store: SessionStore,
    private val prepare: suspend () -> Unit,
    private val appVisible: () -> Boolean,
) {
    private val app = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _session = MutableStateFlow(blankSession())
    val session: StateFlow<Session> = _session.asStateFlow()

    private val _sessions = MutableStateFlow<List<Session>>(emptyList())
    val sessions: StateFlow<List<Session>> = _sessions.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _finished = MutableSharedFlow<Finished>(extraBufferCapacity = 8)
    val finished: SharedFlow<Finished> = _finished.asSharedFlow()

    @Volatile
    var progress: Progress? = null
        private set

    private var job: Job? = null
    private var lastNotified = 0L

    init {
        scope.launch {
            val latest = runCatching { store.latest() }.getOrNull()
            // ระหว่างโหลด ผู้ใช้อาจเริ่มถามไปแล้ว — ไม่ทับบทสนทนาที่กำลังใช้
            if (latest != null && _session.value.turns.isEmpty()) _session.value = latest.recovered()
            refreshSessions()
        }
    }

    /** เริ่มค้น; false = มีคำถามที่กำลังค้นอยู่ */
    fun ask(question: String, fromVoice: Boolean): Boolean {
        if (_busy.value) return false
        val history = _session.value.turns.filter { it.status == TurnStatus.DONE }
        val turn = Turn(id = newId(), question = question, askedAt = System.currentTimeMillis())
        _session.update { s -> s.copy(title = s.title.ifBlank { question.take(60) }, turns = s.turns + turn) }
        _busy.value = true
        progress = Progress(question, turn.askedAt, "วางแผน", 0)
        ResearchService.start(app)
        val lock = wakeLock()

        job = scope.launch {
            var outcome: Finished? = null
            try {
                persist()
                prepare()
                val result = agent.run(
                    question,
                    history,
                    onProgress = { sources, images ->
                        // แผงทยอยขึ้นระหว่างค้น (ที่มา/คลิป/ภาพ)
                        updateTurn(turn.id) { if (it.status == TurnStatus.RUNNING) it.copy(sources = sources, images = images) else it }
                        onStep(null, sources.size)
                    },
                ) { steps ->
                    updateTurn(turn.id) { it.copy(trace = steps) }
                    onStep(steps, null)
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
                outcome = Finished(turn.id, fromVoice, result.briefing.spoken, null)
            } catch (e: CancellationException) {
                updateTurn(turn.id) { it.copy(status = TurnStatus.CANCELLED, error = "หยุดแล้ว") }
                throw e
            } catch (e: Exception) {
                val message = friendlyError(e)
                updateTurn(turn.id) { it.copy(status = TurnStatus.FAILED, error = message) }
                outcome = Finished(turn.id, fromVoice, null, message)
            } finally {
                _busy.value = false
                progress = null
                ResearchService.finish(app)
                runCatching { if (lock?.isHeld == true) lock.release() }
                withContext(NonCancellable) { persist() }
                outcome?.let { o ->
                    val done = _session.value.turns.firstOrNull { it.id == o.turnId }
                    if (done != null && !appVisible()) ResearchNotices.showResult(app, done)
                    _finished.tryEmit(o)
                }
            }
        }
        return true
    }

    fun stop() {
        job?.cancel()
    }

    suspend fun stopAndWait() {
        job?.cancelAndJoin()
    }

    /** อัปเดตการแจ้งเตือนระหว่างค้น (ไม่เกินราววินาทีละครั้ง) */
    private fun onStep(steps: List<TraceStep>?, sources: Int?) {
        val p = progress ?: return
        val running = steps?.lastOrNull { !it.done } ?: steps?.lastOrNull()
        val label = running?.let { if (it.detail.isBlank()) it.label else "${it.label}: ${it.detail}" }
        val next = p.copy(step = label ?: p.step, sources = sources ?: p.sources)
        progress = next
        val now = System.currentTimeMillis()
        if (now - lastNotified < 800) return
        lastNotified = now
        ResearchService.update(app, next)
    }

    private fun wakeLock(): PowerManager.WakeLock? = runCatching {
        val pm = app.getSystemService(PowerManager::class.java)
        pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "jarvis:research").apply {
            setReferenceCounted(false)
            acquire(WAKE_LOCK_MAX_MS)
        }
    }.getOrNull()

    // ---------- บทสนทนา ----------

    fun updateTurn(id: String, change: (Turn) -> Turn) {
        _session.update { s -> s.copy(turns = s.turns.map { if (it.id == id) change(it) else it }) }
    }

    fun removeTurn(id: String) {
        _session.update { s -> s.copy(turns = s.turns.filterNot { it.id == id }) }
    }

    fun newSession() {
        _session.value = blankSession()
        scope.launch { refreshSessions() }
    }

    suspend fun open(id: String): Boolean {
        val loaded = store.load(id) ?: return false
        _session.value = loaded.recovered()
        return true
    }

    suspend fun delete(id: String) {
        store.delete(id)
        if (_session.value.id == id) _session.value = blankSession()
        refreshSessions()
    }

    suspend fun persist() {
        runCatching { store.save(_session.value) }
        refreshSessions()
    }

    private suspend fun refreshSessions() {
        _sessions.value = runCatching { store.list() }.getOrDefault(emptyList())
    }

    private fun blankSession() = Session(id = newId(), createdAt = System.currentTimeMillis())

    private fun newId() = UUID.randomUUID().toString()

    /** คำถามที่ค้างอยู่ตอนแอปถูกปิดกลางคัน ให้ขึ้นเป็น "ถูกขัดจังหวะ" กดลองใหม่ได้ */
    private fun Session.recovered(): Session = copy(
        turns = turns.map {
            if (it.status == TurnStatus.RUNNING) it.copy(status = TurnStatus.FAILED, error = "ถูกขัดจังหวะ — กดลองใหม่ได้") else it
        }
    )

    private companion object {
        /** กันลืมปล่อย: งานหนึ่งใช้ไม่เกิน ~3 นาทีอยู่แล้ว */
        const val WAKE_LOCK_MAX_MS = 5 * 60_000L
    }
}
