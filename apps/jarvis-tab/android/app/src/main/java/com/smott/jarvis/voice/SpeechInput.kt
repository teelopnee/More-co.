package com.smott.jarvis.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

sealed interface MicState {
    data object Idle : MicState
    data class Listening(val partial: String = "", val level: Float = 0f) : MicState
    data class Error(val message: String) : MicState
}

/**
 * แปลงเสียงพูดเป็นข้อความด้วยบริการของเครื่อง (รองรับภาษาไทย)
 * - สร้างตัวรับเสียงใหม่ทุกครั้ง ป้องกันอาการค้าง/ERROR_RECOGNIZER_BUSY ที่พบบ่อย
 * - onEnd ถูกเรียกครั้งเดียวเสมอเมื่อจบรอบ (ได้ผล/ผิดพลาด/ยกเลิก/หมดเวลา) — ใช้คืนไมค์ให้ระบบคำปลุก
 * - ตัวรับเสียงบางเครื่องไม่ตอบกลับเลย จึงมีตัวจับเวลาตัดที่ 20 วินาที
 */
class SpeechInput(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private val _state = MutableStateFlow<MicState>(MicState.Idle)
    val state: StateFlow<MicState> = _state.asStateFlow()

    private var recognizer: SpeechRecognizer? = null
    private var onEnd: (() -> Unit)? = null
    private val watchdog = Runnable {
        if (recognizer != null) {
            release()
            _state.value = MicState.Idle
            end()
        }
    }

    val isListening: Boolean get() = _state.value is MicState.Listening

    fun start(language: String, onResult: (String) -> Unit, onEnd: () -> Unit = {}) {
        main.post { begin(language, onResult, onEnd) }
    }

    /** หยุดฟังแล้วส่งข้อความที่ได้ */
    fun stop() {
        main.post { recognizer?.stopListening() }
    }

    /** ยกเลิกโดยไม่ส่งข้อความ */
    fun cancel() {
        main.post {
            release()
            _state.value = MicState.Idle
            end()
        }
    }

    private fun end() {
        main.removeCallbacks(watchdog)
        val cb = onEnd
        onEnd = null
        cb?.invoke()
    }

    private fun begin(language: String, onResult: (String) -> Unit, onEnd: () -> Unit) {
        release()
        end()
        this.onEnd = onEnd
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            _state.value = MicState.Error("เครื่องนี้ยังไม่มีบริการแปลงเสียงเป็นข้อความ — ติดตั้ง/เปิด Google หรือ Samsung voice input")
            end()
            return
        }
        val r = SpeechRecognizer.createSpeechRecognizer(context)
        r.setRecognitionListener(listenerFor(r, onResult))
        recognizer = r
        _state.value = MicState.Listening()
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        }
        try {
            r.startListening(intent)
            main.postDelayed(watchdog, 20_000)
        } catch (e: Exception) {
            release()
            _state.value = MicState.Error("เริ่มฟังไม่ได้: ${e.message}")
            end()
        }
    }

    private fun release() {
        recognizer?.let { r ->
            runCatching { r.cancel() }
            runCatching { r.destroy() }
        }
        recognizer = null
    }

    private fun listenerFor(owner: SpeechRecognizer, onResult: (String) -> Unit) = object : RecognitionListener {
        private fun stale() = recognizer !== owner

        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}

        override fun onRmsChanged(rmsdB: Float) {
            if (stale()) return
            val cur = _state.value
            if (cur is MicState.Listening) _state.value = cur.copy(level = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f))
        }

        override fun onPartialResults(partialResults: Bundle?) {
            if (stale()) return
            val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            val cur = _state.value
            if (cur is MicState.Listening && text.isNotBlank()) _state.value = cur.copy(partial = text)
        }

        override fun onResults(results: Bundle?) {
            if (stale()) return
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty().trim()
            release()
            _state.value = MicState.Idle
            end()
            if (text.isNotEmpty()) onResult(text)
        }

        override fun onError(error: Int) {
            if (stale()) return
            release()
            _state.value = when (error) {
                SpeechRecognizer.ERROR_NO_MATCH,
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
                SpeechRecognizer.ERROR_CLIENT -> MicState.Idle
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> MicState.Error("ต้องอนุญาตไมโครโฟนก่อน")
                SpeechRecognizer.ERROR_NETWORK,
                SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> MicState.Error("แปลงเสียงไม่ได้เพราะเครือข่าย ลองใหม่อีกครั้ง")
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> MicState.Error("ระบบรับเสียงไม่ว่าง ลองใหม่อีกครั้ง")
                12, 13 -> MicState.Error("บริการรับเสียงยังไม่รองรับภาษานี้ — ดาวน์โหลดภาษาไทยในการตั้งค่าเสียงของเครื่อง")
                else -> MicState.Error("รับเสียงไม่สำเร็จ (รหัส $error)")
            }
            end()
        }
    }
}
