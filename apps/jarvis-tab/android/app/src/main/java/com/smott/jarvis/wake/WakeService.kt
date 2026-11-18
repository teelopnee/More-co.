package com.smott.jarvis.wake

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.smott.jarvis.JarvisApp
import com.smott.jarvis.MainActivity

/**
 * Foreground service ประเภทไมโครโฟน: ให้ฟังคำปลุกต่อได้แม้สลับไปแอปอื่น (มีการแจ้งเตือนบอกเสมอ)
 * Android อนุญาตให้เริ่มได้เฉพาะตอนแอปอยู่บนจอ จึงเริ่มจาก MainActivity.onStart เท่านั้น
 */
class WakeService : Service() {
    private val wake get() = (application as JarvisApp).container.wake

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            // หยุดจนกว่าจะเปิดแอปครั้งถัดไป (ปิดถาวรได้ในหน้าตั้งค่า)
            stopSelf()
            return START_NOT_STICKY
        }
        ensureChannels(this)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            } else {
                startForeground(NOTIFICATION_ID, notification())
            }
        } catch (e: Exception) {
            // เช่น ForegroundServiceStartNotAllowedException ตอนแอปไม่ได้อยู่บนจอ
            wake.reportFailure("เริ่มฟังเบื้องหลังไม่ได้: เปิดแอปค้างไว้ก่อน แล้วจะฟังต่อเอง")
            stopSelf()
            return START_NOT_STICKY
        }
        wake.start()
        // ถ้าระบบปิด service ไป ไม่ต้องให้เริ่มเองจากเบื้องหลัง (Android ไม่อนุญาตไมค์จากเบื้องหลัง) — จะเริ่มใหม่ตอนเปิดแอป
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        wake.stop()
        super.onDestroy()
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            this, 1,
            Intent(this, WakeService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_LISTEN)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Jarvis พร้อมฟัง")
            .setContentText("พูดว่า \"Hey Jarvis\" เพื่อเรียก — เสียงประมวลผลในเครื่องเท่านั้น")
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(open)
            .addAction(0, "หยุดฟัง", stop)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    companion object {
        private const val NOTIFICATION_ID = 41
        private const val PROMPT_ID = 42
        private const val ACTION_STOP = "com.smott.jarvis.STOP_WAKE"
        private const val CHANNEL_LISTEN = "jarvis_wake"
        private const val CHANNEL_PROMPT = "jarvis_wake_prompt"

        fun start(context: Context) {
            runCatching { ContextCompat.startForegroundService(context, Intent(context, WakeService::class.java)) }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, WakeService::class.java))
        }

        fun ensureChannels(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java) ?: return
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_LISTEN, "ฟังคำปลุก", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "แสดงตลอดเวลาที่ Jarvis ฟังคำว่า Hey Jarvis"
                    setShowBadge(false)
                }
            )
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_PROMPT, "ถูกเรียก", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "เด้งขึ้นเมื่อได้ยินคำว่า Hey Jarvis ตอนที่แอปไม่ได้อยู่บนจอ"
                }
            )
        }

        /** ใช้เมื่อเปิดแอปจากเบื้องหลังเองไม่ได้ (ยังไม่ได้อนุญาต "แสดงทับแอปอื่น") */
        fun showWakePrompt(context: Context, intent: Intent) {
            ensureChannels(context)
            val pi = PendingIntent.getActivity(context, 2, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val n = NotificationCompat.Builder(context, CHANNEL_PROMPT)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("ได้ยินคุณเรียก")
                .setContentText("แตะเพื่อสั่งงาน Jarvis")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setAutoCancel(true)
                .setTimeoutAfter(20_000)
                .setContentIntent(pi)
                .setFullScreenIntent(pi, true)
                .build()
            runCatching { context.getSystemService(NotificationManager::class.java)?.notify(PROMPT_ID, n) }
        }
    }
}
