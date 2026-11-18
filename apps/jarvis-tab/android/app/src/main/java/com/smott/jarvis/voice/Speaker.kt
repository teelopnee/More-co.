package com.smott.jarvis.voice

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * อ่านออกเสียงด้วย TTS ของเครื่อง
 * แต่ละประโยคมี onDone ของตัวเอง (ใช้ต่อขั้นตอน: ทักทาย → ฟัง, อธิบายทีละแผง)
 * - อ่านจบหรืออ่านไม่ได้ → เรียก onDone เสมอ (งานถัดไปจึงไม่ค้าง)
 * - ถูกสั่งหยุด → ไม่เรียก onDone (ยกเลิกทั้งลำดับ)
 */
class Speaker(context: Context) : TextToSpeech.OnInitListener {
    private val main = Handler(Looper.getMainLooper())
    private val _speaking = MutableStateFlow(false)
    val speaking: StateFlow<Boolean> = _speaking.asStateFlow()

    private val callbacks = ConcurrentHashMap<String, () -> Unit>()
    private val seq = AtomicLong()

    @Volatile
    private var ready = false

    @Volatile
    private var failed = false

    /** คำขอที่มาก่อน TTS พร้อม (เช่นถูกปลุกตอนเพิ่งเปิดแอป) — เก็บไว้ 1 รายการ */
    private var pending: Triple<String, String, (() -> Unit)?>? = null

    private val progress = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {
            _speaking.value = true
        }

        override fun onDone(utteranceId: String?) {
            _speaking.value = false
            finish(utteranceId)
        }

        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) {
            _speaking.value = false
            finish(utteranceId)
        }

        override fun onError(utteranceId: String?, errorCode: Int) {
            _speaking.value = false
            finish(utteranceId)
        }

        override fun onStop(utteranceId: String?, interrupted: Boolean) {
            _speaking.value = false
            if (utteranceId != null) callbacks.remove(utteranceId)
        }
    }

    private val tts = TextToSpeech(context.applicationContext, this)

    private fun finish(id: String?) {
        val cb = id?.let { callbacks.remove(it) } ?: return
        main.post(cb)
    }

    override fun onInit(status: Int) {
        ready = status == TextToSpeech.SUCCESS
        failed = !ready
        if (ready) tts.setOnUtteranceProgressListener(progress)
        main.post {
            val p = pending ?: return@post
            pending = null
            speak(p.first, p.second, p.third)
        }
    }

    fun speak(text: String, languageTag: String, onDone: (() -> Unit)? = null) {
        if (text.isBlank() || failed) {
            onDone?.let { main.post(it) }
            return
        }
        if (!ready) {
            pending = Triple(text, languageTag, onDone)
            return
        }
        val locale = Locale.forLanguageTag(languageTag)
        if (tts.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) tts.setLanguage(locale)
        val clipped = text.take(TextToSpeech.getMaxSpeechInputLength() - 1)
        val id = "jarvis-${seq.incrementAndGet()}"
        if (onDone != null) callbacks[id] = onDone
        val result = runCatching { tts.speak(clipped, TextToSpeech.QUEUE_FLUSH, null, id) }.getOrDefault(TextToSpeech.ERROR)
        if (result != TextToSpeech.SUCCESS) finish(id)
    }

    fun stop() {
        pending = null
        callbacks.clear()
        if (ready) runCatching { tts.stop() }
        _speaking.value = false
    }
}
