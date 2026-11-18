package com.smott.jarvis.core.wake

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.nio.FloatBuffer
import kotlin.math.log10
import kotlin.math.sqrt

/*
 * คำปลุก "Hey Jarvis" แบบออฟไลน์ทั้งหมด (ไม่ส่งเสียงออกนอกเครื่อง)
 * พอร์ตจาก openWakeWord (โค้ด Apache-2.0, โมเดล hey_jarvis CC BY-NC-SA 4.0 = ใช้ส่วนตัวได้)
 *
 * เสียง 16 kHz mono ทีละ 1280 ตัวอย่าง (80 ms):
 *   melspectrogram.onnx → 8 เฟรม × 32  (แปลงด้วย x/10 + 2)
 *   embedding_model.onnx ← 76 เฟรมล่าสุด → เวกเตอร์ 96
 *   hey_jarvis.onnx      ← 16 เวกเตอร์ล่าสุด → คะแนน 0..1
 */

/** โมเดล 3 ตัวของ openWakeWord — แยกเป็น interface เพื่อทดสอบและเปลี่ยนตัวรันได้ */
interface WakeModels : AutoCloseable {
    /** ตัวอย่างเสียง (ค่าแบบ int16 แต่เป็น float) → เฟรม mel [n][32] (ยังไม่แปลง) */
    fun melspectrogram(samples: FloatArray): List<FloatArray>

    /** หน้าต่าง mel 76 เฟรม → เวกเตอร์ 96 */
    fun embedding(window: List<FloatArray>): FloatArray

    /** เวกเตอร์ 16 ตัวล่าสุด → คะแนน */
    fun classify(features: List<FloatArray>): Float
}

/** รันด้วย ONNX Runtime (API เดียวกันทั้งบน Android และบนคอมตอนทดสอบ) */
class OrtWakeModels(melspec: ByteArray, embedding: ByteArray, wakeword: ByteArray) : WakeModels {
    private val env = OrtEnvironment.getEnvironment()
    private val options = OrtSession.SessionOptions().apply {
        setIntraOpNumThreads(1)
        setInterOpNumThreads(1)
    }
    private val mel = env.createSession(melspec, options)
    private val emb = env.createSession(embedding, options)
    private val wake = env.createSession(wakeword, options)
    private val melIn = mel.inputNames.first()
    private val embIn = emb.inputNames.first()
    private val wakeIn = wake.inputNames.first()

    private fun run(session: OrtSession, input: String, data: FloatArray, shape: LongArray): FloatArray =
        OnnxTensor.createTensor(env, FloatBuffer.wrap(data), shape).use { tensor ->
            session.run(mapOf(input to tensor)).use { result ->
                val buf = (result.get(0) as OnnxTensor).floatBuffer
                FloatArray(buf.remaining()).also { buf.get(it) }
            }
        }

    override fun melspectrogram(samples: FloatArray): List<FloatArray> {
        val flat = run(mel, melIn, samples, longArrayOf(1, samples.size.toLong()))
        return List(flat.size / MEL_BINS) { f -> flat.copyOfRange(f * MEL_BINS, (f + 1) * MEL_BINS) }
    }

    override fun embedding(window: List<FloatArray>): FloatArray {
        val flat = FloatArray(window.size * MEL_BINS)
        window.forEachIndexed { i, row -> System.arraycopy(row, 0, flat, i * MEL_BINS, MEL_BINS) }
        return run(emb, embIn, flat, longArrayOf(1, window.size.toLong(), MEL_BINS.toLong(), 1))
    }

    override fun classify(features: List<FloatArray>): Float {
        val dim = features.first().size
        val flat = FloatArray(features.size * dim)
        features.forEachIndexed { i, row -> System.arraycopy(row, 0, flat, i * dim, dim) }
        return run(wake, wakeIn, flat, longArrayOf(1, features.size.toLong(), dim.toLong())).first()
    }

    override fun close() {
        runCatching { mel.close() }
        runCatching { emb.close() }
        runCatching { wake.close() }
        runCatching { options.close() }
    }

    companion object {
        const val MEL_BINS = 32
    }
}

/** ท่อประมวลผลแบบต่อเนื่อง: ป้อนทีละ 1280 ตัวอย่าง ได้คะแนนคำปลุกกลับมา */
class WakeWordEngine(private val models: WakeModels) {
    private val raw = FloatArray(CHUNK + OVERLAP)
    private val mel = ArrayDeque<FloatArray>()
    private val feats = ArrayDeque<FloatArray>()
    private var frames = 0

    init {
        reset()
    }

    /** ล้างสถานะทั้งหมด (เรียกหลังพักไมค์ เพื่อไม่ให้เสียงเก่าทำให้ปลุกซ้ำ) */
    fun reset() {
        raw.fill(0f)
        mel.clear()
        repeat(MEL_WINDOW) { mel.addLast(FloatArray(OrtWakeModels.MEL_BINS) { 1f }) }
        feats.clear()
        // เหมือนต้นฉบับ: เติมบัฟเฟอร์ด้วยเวกเตอร์ของเสียงรบกวนเบา ๆ 4 วินาที (สุ่มแบบคงที่ ผลจึงซ้ำได้)
        val rnd = java.util.Random(20_241_118)
        val noise = FloatArray(SAMPLE_RATE * 4) { (rnd.nextInt(2000) - 1000).toFloat() }
        val spec = models.melspectrogram(noise).map(::transform)
        var i = 0
        while (i + MEL_WINDOW <= spec.size) {
            feats.addLast(models.embedding(spec.subList(i, i + MEL_WINDOW)))
            i += 8
        }
        while (feats.size > MAX_FEATS) feats.removeFirst()
        frames = 0
    }

    /** ป้อนเสียง 1280 ตัวอย่าง (int16) → คะแนน 0..1 (5 ช่วงแรกหลัง reset คืน 0 เหมือนต้นฉบับ) */
    fun process(chunk: ShortArray): Float {
        require(chunk.size == CHUNK) { "ต้องป้อนทีละ $CHUNK ตัวอย่าง" }
        System.arraycopy(raw, CHUNK, raw, 0, OVERLAP)
        for (k in 0 until CHUNK) raw[OVERLAP + k] = chunk[k].toFloat()

        models.melspectrogram(raw).forEach { mel.addLast(transform(it)) }
        while (mel.size > MAX_MEL) mel.removeFirst()

        feats.addLast(models.embedding(mel.toList().takeLast(MEL_WINDOW)))
        while (feats.size > MAX_FEATS) feats.removeFirst()

        frames++
        val score = models.classify(feats.toList().takeLast(FEAT_WINDOW))
        return if (frames <= WARMUP) 0f else score
    }

    private fun transform(row: FloatArray) = FloatArray(row.size) { row[it] / 10f + 2f }

    companion object {
        const val SAMPLE_RATE = 16_000
        const val CHUNK = 1280
        private const val OVERLAP = 480
        private const val MEL_WINDOW = 76
        private const val FEAT_WINDOW = 16
        private const val MAX_MEL = 120
        private const val MAX_FEATS = 120
        private const val WARMUP = 5
    }
}

/**
 * ตัดสินว่า "ถูกเรียก" หรือไม่ ให้เสถียรกว่าการดูคะแนนช่วงเดียว:
 * - คะแนน ≥ threshold ติดกันอย่างน้อย [minHits] ช่วง (80 ms ต่อช่วง) — กันเสียงคล้าย ๆ ที่โผล่แวบเดียว
 * - ปลุกแล้วพัก [cooldownChunks] ช่วง กันปลุกซ้ำจากคำเดิม
 */
class WakeDetector(
    private val engine: WakeWordEngine,
    @Volatile var threshold: Float = DEFAULT_THRESHOLD,
    private val minHits: Int = 2,
    private val cooldownChunks: Int = 25,
) {
    private var hits = 0
    private var cool = 0

    @Volatile
    var lastScore: Float = 0f
        private set

    @Volatile
    var lastLevelDb: Float = -90f
        private set

    /** ป้อนเสียง 80 ms → true ถ้าเพิ่งถูกปลุก */
    fun feed(chunk: ShortArray): Boolean {
        lastLevelDb = levelDb(chunk)
        val score = engine.process(chunk)
        lastScore = score
        if (cool > 0) {
            cool--
            hits = 0
            return false
        }
        hits = if (score >= threshold) hits + 1 else 0
        if (hits >= minHits) {
            hits = 0
            cool = cooldownChunks
            return true
        }
        return false
    }

    fun reset() {
        engine.reset()
        hits = 0
        cool = 0
        lastScore = 0f
    }

    companion object {
        const val DEFAULT_THRESHOLD = 0.5f

        /** ระดับเสียงเป็น dBFS (0 = ดังสุด) ใช้แสดงมิเตอร์ */
        fun levelDb(chunk: ShortArray): Float {
            var sum = 0.0
            for (s in chunk) sum += s.toDouble() * s
            val rms = sqrt(sum / chunk.size.coerceAtLeast(1))
            return if (rms < 1.0) -90f else (20 * log10(rms / 32768.0)).toFloat()
        }
    }
}
