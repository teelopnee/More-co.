package com.smott.jarvis.core

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json

/** JSON ที่ทนต่อข้อมูลไม่ครบหรือรูปแบบเพี้ยนเล็กน้อยจากโมเดลและ API ภายนอก */
@OptIn(ExperimentalSerializationApi::class)
val JarvisJson: Json = Json {
    ignoreUnknownKeys = true
    isLenient = true
    coerceInputValues = true
    explicitNulls = false
    encodeDefaults = true
    decodeEnumsCaseInsensitive = true
}

/** ข้อผิดพลาดจากการตั้งค่า (เช่น ยังไม่ได้ใส่ API key) — ข้อความแสดงให้ผู้ใช้เห็นได้ตรง ๆ */
class ConfigException(message: String) : Exception(message)
