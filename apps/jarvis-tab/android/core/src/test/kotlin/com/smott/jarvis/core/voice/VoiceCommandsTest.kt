package com.smott.jarvis.core.voice

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class VoiceCommandsTest {
    @Test
    fun shortCommandsInThaiAndEnglish() {
        assertEquals(VoiceCommand.Stop, VoiceCommands.parse("หยุด"))
        assertEquals(VoiceCommand.Stop, VoiceCommands.parse("หยุดก่อนนะครับ"))
        assertEquals(VoiceCommand.Stop, VoiceCommands.parse("Stop."))
        assertEquals(VoiceCommand.ClearView, VoiceCommands.parse("เคลียร์จอหน่อย"))
        assertEquals(VoiceCommand.ClearView, VoiceCommands.parse("Jarvis, clear the screen"))
        assertEquals(VoiceCommand.NewSession, VoiceCommands.parse("เริ่มใหม่"))
        assertEquals(VoiceCommand.Walkthrough, VoiceCommands.parse("อธิบายให้ฟังหน่อย"))
        assertEquals(VoiceCommand.Walkthrough, VoiceCommands.parse("walk me through it"))
        assertEquals(VoiceCommand.Walkthrough, VoiceCommands.parse("เล่าให้ฟังที"))
        assertEquals(VoiceCommand.Mute, VoiceCommands.parse("ปิดเสียง"))
        assertEquals(VoiceCommand.Unmute, VoiceCommands.parse("เปิดเสียงครับ"))
        assertEquals(VoiceCommand.Repeat, VoiceCommands.parse("พูดอีกที"))
        assertEquals(VoiceCommand.Nothing, VoiceCommands.parse("ครับ"))
        assertEquals(VoiceCommand.Nothing, VoiceCommands.parse("  "))
    }

    @Test
    fun realQuestionsGoToTheModel() {
        listOf(
            "อธิบายให้ฟังหน่อยว่าทำไม NVDA ลง",
            "หยุดงานประท้วงที่ฝรั่งเศสเป็นยังไงบ้าง",
            "วิเคราะห์ตลาดหุ้นเทควันนี้ให้หน่อย",
            "stop loss ของ TSLA ควรตั้งเท่าไร",
            "เปิด Samsung Notes",
        ).forEach { q ->
            val c = VoiceCommands.parse(q)
            assertIs<VoiceCommand.Ask>(c, q)
            assertEquals(q, c.text)
        }
    }
}
