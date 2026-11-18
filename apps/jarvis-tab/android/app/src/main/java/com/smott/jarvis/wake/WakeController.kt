package com.smott.jarvis.wake

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.smott.jarvis.core.wake.OrtWakeModels
import com.smott.jarvis.core.wake.WakeDetector
import com.smott.jarvis.core.wake.WakeWordEngine
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

sealed interface WakeStatus {
    data object Off : WakeStatus
    data object Loading : WakeStatus
    data class Listening(val levelDb: Float, val score: Float, val micBusy: Boolean) : WakeStatus
    data class Paused(val reason: String) : WakeStatus
    data class Failed(val message: String) : WakeStatus
}

/**
 * ฟังคำว่า "Hey Jarvis" ตลอดเวลาในเธรดของตัวเอง (ทุกอย่างอยู่ในเครื่อง ไม่ส่งเสียงออกไปไหน)
 *
 * เสถียรภาพ:
 * - ไมค์เปิดไม่ได้/หลุด → ปิดแล้วเปิดใหม่เอง (รอนานขึ้นทีละขั้น สูงสุด 5 วินาที)
 * - ระหว่างที่แอปฟังคำสั่ง/พูดทักทาย ต้อง "พักไมค์" ด้วย [hold] ไม่อย่างนั้นแย่งไมค์กับตัวแปลงเสียง
 * - หลังพัก ล้างบัฟเฟอร์ก่อนฟังต่อ จึงไม่ปลุกซ้ำจากเสียงเก่า
 * - ปลุกแล้วพัก 2 วินาที และต้องได้คะแนนสูงติดกัน 2 ช่วงขึ้นไปจึงนับ
 */
class WakeController(private val app: Context) {
    private val _status = MutableStateFlow<WakeStatus>(WakeStatus.Off)
    val status: StateFlow<WakeStatus> = _status.asStateFlow()

    private val _wakes = MutableSharedFlow<Long>(extraBufferCapacity = 4)

    /** ถูกปลุกขณะที่แอปอยู่บนจอ (ViewModel ฟังอยู่) */
    val wakes: SharedFlow<Long> = _wakes.asSharedFlow()

    /** ถูกปลุกตอนแอปไม่ได้อยู่บนจอ → ให้ AppContainer เปิดแอปขึ้นมา */
    @Volatile
    var onWakeInBackground: (() -> Unit)? = null

    @Volatile
    var appVisible: Boolean = false

    @Volatile
    var threshold: Float = WakeDetector.DEFAULT_THRESHOLD

    private val lock = Object()
    private val holds = HashSet<String>()
    private var loop: Loop? = null
    private var detector: WakeDetector? = null

    val running: Boolean get() = synchronized(lock) { loop?.isAlive == true }

    fun start() {
        synchronized(lock) {
            if (loop?.isAlive == true) return
            loop = Loop().also { it.start() }
        }
    }

    fun stop() {
        val l = synchronized(lock) {
            val current = loop
            loop = null
            current?.running = false
            lock.notifyAll()
            current
        }
        l?.interrupt()
        l?.join(1500)
        _status.value = WakeStatus.Off
    }

    /** พักไมค์ (เช่นระหว่างฟังคำสั่ง) — เรียกซ้ำด้วย tag เดิมได้ */
    fun hold(tag: String) {
        synchronized(lock) {
            holds += tag
            lock.notifyAll()
        }
    }

    fun release(tag: String) {
        synchronized(lock) {
            holds -= tag
            lock.notifyAll()
        }
    }

    fun reportFailure(message: String) {
        _status.value = WakeStatus.Failed(message)
    }

    private fun loadDetector(): WakeDetector {
        detector?.let { return it }
        fun asset(name: String) = app.assets.open("wake/$name").use { it.readBytes() }
        val models = OrtWakeModels(asset("melspectrogram.onnx"), asset("embedding_model.onnx"), asset("hey_jarvis_v0.1.onnx"))
        return WakeDetector(WakeWordEngine(models)).also { detector = it }
    }

    @SuppressLint("MissingPermission")
    private fun openRecorder(): AudioRecord? {
        if (ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return null
        val min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (min <= 0) return null
        val size = maxOf(min, WakeWordEngine.CHUNK * 2 * 4)
        for (source in intArrayOf(MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC)) {
            val r = try {
                AudioRecord(source, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, size)
            } catch (e: Exception) {
                null
            } ?: continue
            if (r.state != AudioRecord.STATE_INITIALIZED) {
                r.release()
                continue
            }
            try {
                r.startRecording()
            } catch (e: Exception) {
                r.release()
                continue
            }
            if (r.recordingState == AudioRecord.RECORDSTATE_RECORDING) return r
            r.release()
        }
        return null
    }

    private fun close(r: AudioRecord?): AudioRecord? {
        if (r != null) {
            runCatching { r.stop() }
            runCatching { r.release() }
        }
        return null
    }

    /** อ่านให้ครบ 1280 ตัวอย่าง; false = ไมค์มีปัญหา */
    private fun readFully(r: AudioRecord, buf: ShortArray): Boolean {
        var off = 0
        var zeros = 0
        while (off < buf.size) {
            val n = r.read(buf, off, buf.size - off)
            when {
                n > 0 -> off += n
                n == 0 -> if (++zeros > 50) return false
                else -> return false
            }
        }
        return true
    }

    @Suppress("DEPRECATION")
    private fun wakeScreenIfOff() {
        val pm = app.getSystemService(PowerManager::class.java) ?: return
        if (pm.isInteractive) return
        runCatching {
            pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
                "jarvis:wake-screen",
            ).acquire(8_000)
        }
    }

    private fun onWake() {
        wakeScreenIfOff()
        if (appVisible) _wakes.tryEmit(SystemClock.elapsedRealtime()) else onWakeInBackground?.invoke()
    }

    private inner class Loop : Thread("jarvis-wake") {
        @Volatile
        var running = true

        override fun run() {
            Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
            _status.value = WakeStatus.Loading
            val det = try {
                loadDetector()
            } catch (e: Throwable) {
                _status.value = WakeStatus.Failed("โหลดโมเดลคำปลุกไม่ได้: ${e.message ?: e.javaClass.simpleName}")
                return
            }
            det.reset()
            var rec: AudioRecord? = null
            val chunk = ShortArray(WakeWordEngine.CHUNK)
            var failures = 0
            var silent = 0
            var tick = 0
            try {
                while (running) {
                    val held = synchronized(lock) { holds.isNotEmpty() }
                    if (held) {
                        rec = close(rec)
                        _status.value = WakeStatus.Paused("กำลังฟังคำสั่ง")
                        synchronized(lock) {
                            while (running && holds.isNotEmpty()) lock.wait(1000)
                        }
                        det.reset()
                        continue
                    }
                    if (rec == null) {
                        rec = openRecorder()
                        if (rec == null) {
                            failures++
                            _status.value = WakeStatus.Failed("เปิดไมค์ไม่ได้ (ลองใหม่อัตโนมัติ)")
                            Thread.sleep(minOf(5_000L, 500L * failures))
                            continue
                        }
                    }
                    if (!readFully(rec, chunk)) {
                        rec = close(rec)
                        failures++
                        Thread.sleep(minOf(5_000L, 300L * failures))
                        continue
                    }
                    failures = 0
                    det.threshold = threshold
                    val woke = det.feed(chunk)
                    silent = if (chunk.all { it.toInt() == 0 }) silent + 1 else 0
                    if (++tick % 3 == 0 || woke) {
                        // เสียงเป็น 0 ล้วนนานเกิน 3 วินาที = แอปอื่น (เช่น Bixby/อัดเสียง) ใช้ไมค์อยู่
                        _status.value = WakeStatus.Listening(det.lastLevelDb, det.lastScore, micBusy = silent > 40)
                    }
                    if (woke) onWake()
                }
            } catch (e: InterruptedException) {
                // หยุดตามสั่ง
            } catch (e: Throwable) {
                _status.value = WakeStatus.Failed("ระบบฟังคำปลุกหยุดทำงาน: ${e.message ?: e.javaClass.simpleName}")
            } finally {
                close(rec)
            }
        }
    }

    companion object {
        const val SAMPLE_RATE = 16_000
    }
}
