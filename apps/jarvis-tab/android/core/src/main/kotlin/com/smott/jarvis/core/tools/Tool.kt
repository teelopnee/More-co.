package com.smott.jarvis.core.tools

import com.smott.jarvis.core.JarvisJson
import com.smott.jarvis.core.agent.ResearchContext
import com.smott.jarvis.core.llm.FunctionDef
import com.smott.jarvis.core.llm.ToolDef
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlinx.serialization.json.add

/** เครื่องมือ 1 ตัวที่โมเดลเรียกใช้ได้ (ค้นเว็บ, ดึงราคา, เปิดแอป ฯลฯ) */
interface Tool {
    val name: String
    val description: String
    val parameters: JsonObject

    /** false = ยังไม่มี API key — จะไม่ส่งเครื่องมือนี้ให้โมเดล */
    val available: Boolean get() = true

    /** บอกผู้ใช้/โมเดลว่าต้องตั้งค่าอะไรถ้าใช้ไม่ได้ */
    val requires: String get() = ""

    /** true = สั่งอุปกรณ์ (เปิดแอป/ลิงก์/ตั้งปลุก) — ห้ามใช้หลังอ่านเนื้อหาจากเว็บแล้ว กันข้อความในเว็บสั่งเครื่อง */
    val device: Boolean get() = false

    /** ป้ายกำกับขั้นตอนที่แสดงสดบนจอ: (หัวข้อ, รายละเอียด) */
    fun traceLabel(args: JsonObject): Pair<String, String>

    /** คืนข้อความ (มักเป็น JSON กระชับ) ให้โมเดลอ่าน */
    suspend fun run(args: JsonObject, ctx: ResearchContext): String
}

fun Tool.toDef(): ToolDef = ToolDef(function = FunctionDef(name, description, parameters))

/** ตัวช่วยสร้าง JSON Schema ของพารามิเตอร์ */
object Schema {
    fun obj(
        vararg props: Pair<String, JsonElement>,
        required: List<String> = emptyList(),
        description: String? = null,
    ): JsonObject = buildJsonObject {
        put("type", "object")
        if (description != null) put("description", description)
        putJsonObject("properties") { props.forEach { (k, v) -> put(k, v) } }
        if (required.isNotEmpty()) putJsonArray("required") { required.forEach { add(it) } }
    }

    fun str(description: String, enum: List<String>? = null): JsonObject = buildJsonObject {
        put("type", "string")
        put("description", description)
        if (enum != null) putJsonArray("enum") { enum.forEach { add(it) } }
    }

    fun int(description: String, min: Int, max: Int): JsonObject = buildJsonObject {
        put("type", "integer")
        put("description", description)
        put("minimum", min)
        put("maximum", max)
    }

    fun arr(items: JsonElement, description: String, maxItems: Int? = null): JsonObject = buildJsonObject {
        put("type", "array")
        put("description", description)
        put("items", items)
        if (maxItems != null) put("maxItems", maxItems)
    }
}

fun JsonObject.str(key: String): String? =
    (this[key] as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }

fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.let { p ->
    p.intOrNull ?: p.doubleOrNull?.toInt() ?: p.contentOrNull?.trim()?.toIntOrNull()
}

fun JsonObject.strList(key: String): List<String> = when (val v = this[key]) {
    is JsonArray -> v.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.trim() }.filter { it.isNotEmpty() }
    is JsonPrimitive -> v.contentOrNull?.split(',', ' ', ';')?.map { it.trim() }?.filter { it.isNotEmpty() }.orEmpty()
    else -> emptyList()
}

fun parseArgs(raw: String?): JsonObject {
    val text = raw?.takeIf { it.isNotBlank() } ?: "{}"
    return runCatching { JarvisJson.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: JsonObject(emptyMap())
}
