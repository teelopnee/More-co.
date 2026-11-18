package com.smott.jarvis.research

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.smott.jarvis.JarvisApp
import com.smott.jarvis.MainActivity
import com.smott.jarvis.core.model.Turn
import com.smott.jarvis.core.model.TurnStatus

/**
 * Foreground service ระหว่างค้นคำตอบ: ทำให้ Android (และโหมดประหยัดแบตของ Samsung) ไม่ปิดแอป/ตัดเน็ต
 * ตอนผู้ใช้สลับไปแอปอื่นหรือปิดจอ — มีการแจ้งเตือน "กำลังค้น…" พร้อมปุ่มหยุดตลอดที่ทำงาน
 *
 * ปิดตัวเองด้วย [finish] (ไม่ใช้ stopService) เพราะถ้าหยุดก่อน service ทันเรียก startForeground แอปจะล่ม
 * — ถ้างานจบก่อน service เริ่ม onStartCommand จะเห็นว่าไม่มีงานแล้วปิดตัวเอง
 */
class ResearchService : Service() {
    private val research get() = (application as JarvisApp).container.research

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            research.stop()
            if (running !== this) stopSelf()
            return START_NOT_STICKY
        }
        val p = research.progress
        val started = runCatching {
            startForeground(
                ResearchNotices.PROGRESS_ID,
                ResearchNotices.progress(this, p ?: Progress("", System.currentTimeMillis(), "", 0)),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        }.isSuccess
        if (!started || p == null) {
            // เริ่มเบื้องหลังไม่ได้ (ไม่เป็นไร งานค้นยังทำต่อ แค่ไม่มีตัวกันระบบปิดแอป) หรืองานจบไปแล้ว
            if (started) stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        running = this
        // ถ้าระบบปิด service ไป ไม่ต้องเริ่มใหม่เอง: งานค้นอยู่ในหน่วยความจำของแอป เริ่มใหม่ก็ไม่มีอะไรให้ทำ
        return START_NOT_STICKY
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        // Android 15: dataSync ทำงานได้ไม่เกิน 6 ชม./วัน — งานค้นไม่ถึงอยู่แล้ว แต่ต้องรองรับ
        research.stop()
        finish(this)
    }

    override fun onDestroy() {
        if (running === this) running = null
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "com.smott.jarvis.STOP_RESEARCH"

        @Volatile
        private var running: ResearchService? = null

        fun start(context: Context) {
            ResearchNotices.ensureChannels(context)
            runCatching { ContextCompat.startForegroundService(context, Intent(context, ResearchService::class.java)) }
        }

        fun update(context: Context, progress: Progress) {
            if (running == null) return
            runCatching {
                context.getSystemService(NotificationManager::class.java)
                    ?.notify(ResearchNotices.PROGRESS_ID, ResearchNotices.progress(context, progress))
            }
        }

        fun finish(context: Context) {
            val s = running
            running = null
            if (s != null) {
                s.stopForeground(STOP_FOREGROUND_REMOVE)
                s.stopSelf()
            }
            runCatching { context.getSystemService(NotificationManager::class.java)?.cancel(ResearchNotices.PROGRESS_ID) }
        }
    }
}

/** การแจ้งเตือนของงานค้น: ระหว่างค้น (เงียบ) และเมื่อเสร็จ (เด้งขึ้น) */
object ResearchNotices {
    const val PROGRESS_ID = 51
    private const val RESULT_ID = 52
    private const val CHANNEL_PROGRESS = "jarvis_research"
    private const val CHANNEL_RESULT = "jarvis_research_done"

    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_PROGRESS, "กำลังค้นคำตอบ", NotificationManager.IMPORTANCE_LOW).apply {
                description = "แสดงระหว่างที่ Jarvis ค้นข้อมูล (ค้นต่อได้แม้ปิดแอป)"
                setShowBadge(false)
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_RESULT, "คำตอบเสร็จแล้ว", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "แจ้งเมื่อค้นเสร็จตอนที่แอปไม่ได้อยู่บนจอ"
            }
        )
    }

    private fun openApp(context: Context, requestCode: Int): PendingIntent = PendingIntent.getActivity(
        context, requestCode,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun progress(context: Context, p: Progress): Notification {
        val stop = PendingIntent.getService(
            context, 11,
            Intent(context, ResearchService::class.java).setAction(ResearchService.ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val text = listOf(p.step, if (p.sources > 0) "${p.sources} ที่มา" else "").filter { it.isNotBlank() }.joinToString(" · ")
        return NotificationCompat.Builder(context, CHANNEL_PROGRESS)
            .setSmallIcon(android.R.drawable.ic_menu_search)
            .setContentTitle(if (p.question.isBlank()) "Jarvis กำลังค้น…" else "กำลังค้น: ${p.question.take(80)}")
            .setContentText(text.ifBlank { "ปิดแอปได้ จะแจ้งเตือนเมื่อเสร็จ" })
            .setSubText("ปิดแอปได้ จะแจ้งเมื่อเสร็จ")
            .setWhen(p.startedAt)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setProgress(0, 0, true)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setContentIntent(openApp(context, 10))
            .addAction(0, "หยุด", stop)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    /** ค้นเสร็จตอนแอปไม่ได้อยู่บนจอ: เด้งหัวข้อ + ประเด็นหลัก แตะแล้วเปิดคำตอบ */
    fun showResult(context: Context, turn: Turn) {
        ensureChannels(context)
        val b = turn.briefing
        val ok = turn.status == TurnStatus.DONE && b != null
        val secs = ((System.currentTimeMillis() - turn.askedAt) / 1000).coerceAtLeast(1)
        val title = if (ok) "Jarvis ตอบแล้ว: ${b!!.title.ifBlank { turn.question }.take(80)}" else "ค้นไม่สำเร็จ: ${turn.question.take(80)}"
        val headline = if (ok) b!!.overview?.headline?.takeIf { it.isNotBlank() } ?: b.spoken else turn.error.orEmpty()
        val big = buildString {
            appendLine(headline)
            if (ok) b!!.overview?.points?.take(3)?.forEach { appendLine("• ${it.text}") }
            append("ใช้เวลา $secs วินาที · แตะเพื่อดูทั้งหมด")
        }
        val n = NotificationCompat.Builder(context, CHANNEL_RESULT)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(headline)
            .setStyle(NotificationCompat.BigTextStyle().bigText(big))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(openApp(context, 12))
            .build()
        runCatching { context.getSystemService(NotificationManager::class.java)?.notify(RESULT_ID, n) }
    }

    fun clearResult(context: Context) {
        runCatching { context.getSystemService(NotificationManager::class.java)?.cancel(RESULT_ID) }
    }
}
