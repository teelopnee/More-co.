package com.smott.jarvis.core.wake

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.float
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * ทดสอบคำปลุกด้วยเสียงจริง (สังเคราะห์ด้วย Piper หลายเสียง) และเทียบกับผลของ openWakeWord ต้นฉบับ (Python)
 * โมเดลเป็นไฟล์เดียวกับที่ใส่ในแอป: app/src/main/assets/wake
 */
class WakeWordTest {
    private val modelDir = File("../app/src/main/assets/wake")
    private val models = OrtWakeModels(
        File(modelDir, "melspectrogram.onnx").readBytes(),
        File(modelDir, "embedding_model.onnx").readBytes(),
        File(modelDir, "hey_jarvis_v0.1.onnx").readBytes(),
    )
    private val engine = WakeWordEngine(models)

    @AfterTest
    fun close() = models.close()

    private fun clip(name: String): ShortArray {
        val bytes = javaClass.getResourceAsStream("/wake/$name")!!.readBytes()
        val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        var pos = 12
        while (pos + 8 <= bytes.size) {
            val id = String(bytes, pos, 4, Charsets.US_ASCII)
            val len = buf.getInt(pos + 4)
            if (id == "data") {
                val out = ShortArray(len / 2)
                buf.position(pos + 8)
                buf.asShortBuffer().get(out, 0, out.size)
                return out
            }
            pos += 8 + len + (len and 1)
        }
        error("no data chunk in $name")
    }

    private fun clips(prefix: String) =
        File(javaClass.getResource("/wake")!!.toURI()).list()!!.filter { it.startsWith(prefix) && it.endsWith(".wav") }.sorted()

    private fun scores(audio: ShortArray): List<Float> {
        engine.reset()
        return (0 until audio.size / WakeWordEngine.CHUNK).map { i ->
            engine.process(audio.copyOfRange(i * WakeWordEngine.CHUNK, (i + 1) * WakeWordEngine.CHUNK))
        }
    }

    private fun detections(audio: ShortArray): Int {
        val d = WakeDetector(engine)
        d.reset()
        var n = 0
        for (i in 0 until audio.size / WakeWordEngine.CHUNK) {
            if (d.feed(audio.copyOfRange(i * WakeWordEngine.CHUNK, (i + 1) * WakeWordEngine.CHUNK))) n++
        }
        return n
    }

    @Test
    fun matchesOriginalOpenWakeWord() {
        val ref = Json.parseToJsonElement(javaClass.getResourceAsStream("/wake/reference_scores.json")!!.reader().readText()).jsonObject
        var worst = 0f
        ref.forEach { (name, arr) ->
            val expected = (arr as JsonArray).map { it.jsonPrimitive.float }
            val got = scores(clip(name))
            assertEquals(expected.size, got.size, name)
            // 20 ช่วงแรกต่างกันได้เพราะต้นฉบับเติมบัฟเฟอร์ด้วยเสียงสุ่ม หลังจากนั้นต้องตรงกัน
            for (i in 20 until got.size) worst = maxOf(worst, abs(expected[i] - got[i]))
        }
        println("ต่างจาก openWakeWord ต้นฉบับมากสุด = $worst")
        assertTrue(worst < 0.02f, "worst diff $worst")
    }

    @Test
    fun wakesOnHeyJarvisInEveryVoice() {
        clips("pos_").forEach { name ->
            val n = detections(clip(name))
            println("ปลุก: $name → $n ครั้ง")
            assertEquals(1, n, "$name ต้องปลุก 1 ครั้งพอดี (ไม่ปลุกซ้ำจากคำเดียว)")
        }
    }

    @Test
    fun ignoresOtherSpeech() {
        clips("neg_").forEach { name ->
            val n = detections(clip(name))
            println("ไม่ปลุก: $name → $n ครั้ง (คะแนนสูงสุด ${"%.2f".format(scores(clip(name)).max())})")
            assertEquals(0, n, name)
        }
    }

    @Test
    fun silenceAndNoiseNeverWake() {
        val rnd = java.util.Random(5)
        val noise = ShortArray(16_000 * 30) { (rnd.nextGaussian() * 1500).toInt().coerceIn(-32768, 32767).toShort() }
        val silence = ShortArray(16_000 * 10)
        assertEquals(0, detections(noise))
        assertEquals(0, detections(silence))
    }

    @Test
    fun wakesAgainAfterCooldownAndIsFastEnough() {
        val one = clip("pos_hey_jarvis__en_US-lessac-medium.wav")
        val twice = one + one
        val start = System.nanoTime()
        val n = detections(twice)
        val ms = (System.nanoTime() - start) / 1e6 / (twice.size / WakeWordEngine.CHUNK)
        println("เวลาประมวลผลเฉลี่ย ${"%.2f".format(ms)} ms ต่อ 80 ms ของเสียง")
        assertEquals(2, n)
        assertTrue(ms < 40, "ช้าเกินไป: $ms ms")
    }
}
