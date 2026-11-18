package com.smott.jarvis.core.voice

/** คำสั่งเสียงสั้น ๆ ที่แอปทำเองทันที ไม่ต้องส่งให้โมเดล (เร็วและไม่เสียเงิน) */
sealed interface VoiceCommand {
    data object Stop : VoiceCommand
    data object ClearView : VoiceCommand
    data object NewSession : VoiceCommand
    data object Walkthrough : VoiceCommand
    data object Mute : VoiceCommand
    data object Unmute : VoiceCommand
    data object Repeat : VoiceCommand
    data object Nothing : VoiceCommand
    data class Ask(val text: String) : VoiceCommand
}

object VoiceCommands {
    private val STOP = listOf("หยุด", "หยุดก่อน", "พอแล้ว", "พอ", "ยกเลิก", "เงียบ", "stop", "cancel", "never mind", "nevermind")
    private val CLEAR = listOf("เคลียร์จอ", "เคลียร์หน้าจอ", "ล้างจอ", "ล้างหน้าจอ", "clear view", "clear the screen", "clear screen")
    private val NEW = listOf("เริ่มใหม่", "เรื่องใหม่", "เซสชันใหม่", "new session", "start over")
    private val WALK = listOf(
        "อธิบายให้ฟัง", "อธิบายทีละข้อ", "เล่าให้ฟัง", "อ่านให้ฟัง", "สรุปให้ฟัง", "ไล่ให้ฟัง", "พาดูทีละข้อ",
        "walk me through it", "walk me through", "read it to me", "talk me through it",
    )
    private val MUTE = listOf("ปิดเสียง", "ไม่ต้องพูด", "mute")
    private val UNMUTE = listOf("เปิดเสียง", "พูดได้", "unmute")
    private val REPEAT = listOf("พูดอีกที", "พูดอีกครั้ง", "ว่าไงนะ", "say that again", "repeat")

    /** คำลงท้าย/คำเรียกที่ตัดทิ้งก่อนเทียบ */
    private val FILLERS = listOf(
        "hey jarvis", "jarvis", "จาร์วิส", "จาวิส", "ครับผม", "ครับ", "ค่ะ", "คะ", "นะ", "หน่อย", "ที", "please", "ok", "okay",
    )

    fun parse(raw: String): VoiceCommand {
        val text = normalize(raw)
        if (text.isEmpty()) return VoiceCommand.Nothing
        val bare = stripFillers(text)
        if (bare.isEmpty()) return VoiceCommand.Nothing
        // เทียบทั้งแบบตัดคำลงท้ายแล้ว และแบบเดิม (เช่น "พูดอีกที" ที่ "ที" เป็นส่วนของคำสั่งเอง)
        val whole = if (text.any { it in 'a'..'z' }) text else text.replace(" ", "")
        fun hit(list: List<String>) = listOf(bare, whole).any { c ->
            list.any { p -> c == p || (c.startsWith(p) && c.length - p.length <= 3) }
        }
        return when {
            hit(WALK) -> VoiceCommand.Walkthrough
            hit(CLEAR) -> VoiceCommand.ClearView
            hit(NEW) -> VoiceCommand.NewSession
            hit(UNMUTE) -> VoiceCommand.Unmute
            hit(MUTE) -> VoiceCommand.Mute
            hit(REPEAT) -> VoiceCommand.Repeat
            hit(STOP) -> VoiceCommand.Stop
            else -> VoiceCommand.Ask(raw.trim())
        }
    }

    private fun normalize(s: String): String =
        s.lowercase().replace(Regex("[\\p{Punct}“”‘’…]"), " ").replace(Regex("\\s+"), " ").trim()

    private fun stripFillers(s: String): String {
        var t = " $s "
        // ตัดซ้ำจนไม่เหลือคำลงท้าย (เช่น "หยุดก่อนนะครับ")
        repeat(3) {
            FILLERS.forEach { f ->
                t = t.replace(" $f ", " ")
                if (t.trimEnd().endsWith(f)) t = t.trimEnd().removeSuffix(f) + " "
                if (t.trimStart().startsWith(f)) t = " " + t.trimStart().removePrefix(f)
            }
        }
        return t.replace(Regex("\\s+"), " ").trim().replace(" ", if (t.any { it in 'a'..'z' }) " " else "")
    }
}
