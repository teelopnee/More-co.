package com.smott.jarvis.core.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonTransformingSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/*
 * โมเดลภาษาบางครั้งส่ง JSON ไม่ตรง schema เป๊ะ เช่น "sources": "S1, S2" แทนที่จะเป็น array
 * หรือส่งข้อความเปล่าแทน object — ตัวแปลงเหล่านี้ทำให้ยังอ่านได้ แทนที่จะพังทั้งคำตอบ
 */

/** รับได้ทั้ง ["S1","S2"] และ "S1, S2" */
object IdList : JsonTransformingSerializer<List<String>>(ListSerializer(String.serializer())) {
    override fun transformDeserialize(element: JsonElement): JsonElement {
        val raw: List<String> = when (element) {
            is JsonArray -> element.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
            is JsonPrimitive -> element.contentOrNull?.split(',', ';', ' ', '\n').orEmpty()
            else -> emptyList()
        }
        return JsonArray(
            raw.map { it.trim().trim('[', ']', '"') }
                .filter { it.isNotEmpty() }
                .map { JsonPrimitive(it) }
        )
    }
}

/** รับได้ทั้ง ["a","b"] และ "a" (ไม่แยกด้วยจุลภาค เพราะเป็นประโยค) */
object TextList : JsonTransformingSerializer<List<String>>(ListSerializer(String.serializer())) {
    override fun transformDeserialize(element: JsonElement): JsonElement = when (element) {
        is JsonArray -> JsonArray(
            element.mapNotNull { e ->
                (e as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }?.let { JsonPrimitive(it) }
            }
        )
        is JsonPrimitive -> element.contentOrNull?.takeIf { it.isNotBlank() }
            ?.let { JsonArray(listOf(JsonPrimitive(it))) } ?: JsonArray(emptyList())
        else -> JsonArray(emptyList())
    }
}

/** ถ้าโมเดลส่งข้อความเปล่ามาแทน object ให้ห่อเป็น {key: ข้อความ} */
open class StringOr<T : Any>(serializer: KSerializer<T>, private val key: String) :
    JsonTransformingSerializer<T>(serializer) {
    override fun transformDeserialize(element: JsonElement): JsonElement =
        if (element is JsonPrimitive && element !is JsonNull) buildJsonObject { put(key, element.content) } else element
}

/** ถ้าโมเดลส่งค่าเดี่ยวมาแทน array ให้ห่อเป็น array 1 ช่อง (null = array ว่าง) */
open class FlexList<T>(element: KSerializer<T>) : JsonTransformingSerializer<List<T>>(ListSerializer(element)) {
    override fun transformDeserialize(element: JsonElement): JsonElement = when (element) {
        is JsonArray -> element
        is JsonNull -> JsonArray(emptyList())
        else -> JsonArray(listOf(element))
    }
}

object CitedFlex : StringOr<Cited>(Cited.serializer(), "text")
object OverviewFlex : StringOr<Overview>(Overview.serializer(), "headline")
object NewsRefFlex : StringOr<NewsRef>(NewsRef.serializer(), "sourceId")
object FactorFlex : StringOr<Factor>(Factor.serializer(), "name")
object AnalysisFlex : StringOr<AnalysisBlock>(AnalysisBlock.serializer(), "body")
object RecommendationFlex : StringOr<Recommendation>(Recommendation.serializer(), "text")
object StatFlex : StringOr<Stat>(Stat.serializer(), "value")

object CitedList : FlexList<Cited>(CitedFlex)
object NewsList : FlexList<NewsRef>(NewsRefFlex)
object FactorList : FlexList<Factor>(FactorFlex)
object AnalysisList : FlexList<AnalysisBlock>(AnalysisFlex)
object RecommendationList : FlexList<Recommendation>(RecommendationFlex)
object StatList : FlexList<Stat>(StatFlex)
object FigureList : FlexList<Figure>(Figure.serializer())
