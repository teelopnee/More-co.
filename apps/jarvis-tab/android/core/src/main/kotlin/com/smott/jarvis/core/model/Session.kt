package com.smott.jarvis.core.model

import kotlinx.serialization.Serializable

@Serializable
enum class TurnStatus { RUNNING, DONE, FAILED, CANCELLED }

/** 1 ขั้นตอนที่ผู้ช่วยกำลังทำ เช่น "ค้นเว็บ: nasdaq today" — แสดงสดบนหน้าจอ */
@Serializable
data class TraceStep(
    val label: String,
    val detail: String = "",
    val done: Boolean = false,
    val failed: Boolean = false,
)

/** คำถาม 1 ครั้ง + ทุกอย่างที่ใช้ตอบ (เก็บไว้ทั้งหมด ข้อมูลเดิมจึงยังอยู่บนจอเมื่อถามต่อ) */
@Serializable
data class Turn(
    val id: String,
    val question: String,
    val askedAt: Long,
    val status: TurnStatus = TurnStatus.RUNNING,
    val trace: List<TraceStep> = emptyList(),
    val briefing: Briefing? = null,
    val error: String? = null,
    val sources: List<Source> = emptyList(),
    val quotes: List<Quote> = emptyList(),
    val series: List<PriceSeries> = emptyList(),
    val images: List<MediaImage> = emptyList(),
)

@Serializable
data class Session(
    val id: String,
    val createdAt: Long,
    val title: String = "",
    val turns: List<Turn> = emptyList(),
)
