package com.smott.jarvis.research

import com.smott.jarvis.core.ConfigException
import com.smott.jarvis.core.llm.LlmException
import com.smott.jarvis.core.net.HttpError
import java.io.InterruptedIOException
import java.net.SocketException
import java.net.UnknownHostException

/** ข้อผิดพลาดเป็นภาษาคน (แสดงบนจอ/การแจ้งเตือน/พูด) */
fun friendlyError(e: Exception): String = when (e) {
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
        503 -> if (e.body.contains("demand", ignoreCase = true)) {
            "รุ่นฟรีของ Gemini คนใช้เยอะมากตอนนี้ (ลองครบทุกรุ่นแล้ว) — รอสักครู่แล้วถามใหม่"
        } else {
            "${e.host} ขัดข้องชั่วคราว ลองใหม่อีกครั้ง"
        }
        in 500..599 -> "${e.host} ขัดข้องชั่วคราว ลองใหม่อีกครั้ง"
        else -> "ข้อผิดพลาดจาก ${e.host} (${e.code})"
    }
    is UnknownHostException -> "ไม่มีอินเทอร์เน็ต"
    is InterruptedIOException -> "เครือข่ายช้าเกินไป ลองใหม่อีกครั้ง"
    is SocketException -> "เน็ตหลุดระหว่างค้น (ลองต่อให้แล้วแต่ไม่สำเร็จ) — ตรวจ Wi-Fi แล้วลองใหม่"
    is LlmException -> e.message.orEmpty()
    else -> e.message ?: e.javaClass.simpleName
}
