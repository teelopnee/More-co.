package com.smott.jarvis.device

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.AlarmClock
import android.provider.CalendarContract
import com.smott.jarvis.core.agent.ResearchContext
import com.smott.jarvis.core.tools.Schema
import com.smott.jarvis.core.tools.Tool
import com.smott.jarvis.core.tools.int
import com.smott.jarvis.core.tools.str
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * คำสั่งอุปกรณ์ที่ "เสถียร" เพราะใช้ช่องทางมาตรฐานของ Android (Intent)
 * ไม่ต้องแตะหน้าจอแทนผู้ใช้ — งานที่ต้องยืนยัน (เช่นเพิ่มนัด) ระบบจะเปิดหน้ายืนยันให้เอง
 */
class DeviceTools(private val context: Context) {

    val tools: List<Tool> = listOf(OpenApp(), OpenUrl(), SetTimer(), SetAlarm(), AddCalendarEvent())

    private fun launch(intent: Intent): Boolean = try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (e: ActivityNotFoundException) {
        false
    } catch (e: SecurityException) {
        false
    }

    private inner class OpenApp : Tool {
        override val device = true
        override val name = "open_app"
        override val description = "Open an installed app on the tablet by name (Thai or English), e.g. Samsung Notes, Chrome, YouTube, Settings, Calendar."
        override val parameters = Schema.obj("name" to Schema.str("App name as the user said it"), required = listOf("name"))
        override fun traceLabel(args: JsonObject) = "เปิดแอป" to args.str("name").orEmpty()

        @Suppress("DEPRECATION")
        override suspend fun run(args: JsonObject, ctx: ResearchContext): String {
            val query = args.str("name")?.lowercase() ?: return "ERROR: name is required"
            val pm = context.packageManager
            val apps = withContext(Dispatchers.IO) {
                val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                pm.queryIntentActivities(launcher, 0)
                    .map { it.loadLabel(pm).toString() to it.activityInfo.packageName }
                    .distinctBy { it.second }
            }
            val match = apps.firstOrNull { it.first.lowercase() == query }
                ?: apps.firstOrNull { it.first.lowercase().contains(query) }
                ?: apps.firstOrNull { it.first.length >= 3 && query.contains(it.first.lowercase()) }
                ?: return "Not found. Installed apps: " + apps.map { it.first }.sorted().take(80).joinToString(", ")
            val intent = pm.getLaunchIntentForPackage(match.second) ?: return "ERROR: ${match.first} cannot be launched"
            return if (launch(intent)) "Opened ${match.first}" else "ERROR: failed to open ${match.first}"
        }
    }

    private inner class OpenUrl : Tool {
        override val device = true
        override val name = "open_url"
        override val description = "Open a web link in the browser."
        override val parameters = Schema.obj("url" to Schema.str("https url"), required = listOf("url"))
        override fun traceLabel(args: JsonObject) = "เปิดลิงก์" to args.str("url").orEmpty()

        override suspend fun run(args: JsonObject, ctx: ResearchContext): String {
            val url = args.str("url") ?: return "ERROR: url is required"
            if (!url.startsWith("https://") && !url.startsWith("http://")) return "ERROR: only http(s) links are allowed"
            return if (launch(Intent(Intent.ACTION_VIEW, Uri.parse(url)))) "Opened $url" else "ERROR: no app can open this link"
        }
    }

    private inner class SetTimer : Tool {
        override val device = true
        override val name = "set_timer"
        override val description = "Start a countdown timer in the Clock app."
        override val parameters = Schema.obj(
            "seconds" to Schema.int("Duration in seconds", 1, 86_400),
            "label" to Schema.str("Optional label"),
            required = listOf("seconds"),
        )
        override fun traceLabel(args: JsonObject) = "ตั้งเวลา" to "${args.int("seconds") ?: 0} วินาที"

        override suspend fun run(args: JsonObject, ctx: ResearchContext): String {
            val seconds = args.int("seconds")?.coerceIn(1, 86_400) ?: return "ERROR: seconds is required"
            val intent = Intent(AlarmClock.ACTION_SET_TIMER)
                .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
                .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            args.str("label")?.let { intent.putExtra(AlarmClock.EXTRA_MESSAGE, it) }
            return if (launch(intent)) "Timer set for $seconds seconds" else "ERROR: no clock app accepted the timer"
        }
    }

    private inner class SetAlarm : Tool {
        override val device = true
        override val name = "set_alarm"
        override val description = "Set an alarm in the Clock app (24-hour time, device local time)."
        override val parameters = Schema.obj(
            "hour" to Schema.int("Hour 0-23", 0, 23),
            "minute" to Schema.int("Minute 0-59", 0, 59),
            "label" to Schema.str("Optional label"),
            required = listOf("hour", "minute"),
        )
        override fun traceLabel(args: JsonObject) =
            "ตั้งปลุก" to "%02d:%02d".format(args.int("hour") ?: 0, args.int("minute") ?: 0)

        override suspend fun run(args: JsonObject, ctx: ResearchContext): String {
            val hour = args.int("hour")?.takeIf { it in 0..23 } ?: return "ERROR: hour 0-23 is required"
            val minute = args.int("minute")?.takeIf { it in 0..59 } ?: 0
            val intent = Intent(AlarmClock.ACTION_SET_ALARM)
                .putExtra(AlarmClock.EXTRA_HOUR, hour)
                .putExtra(AlarmClock.EXTRA_MINUTES, minute)
                .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            args.str("label")?.let { intent.putExtra(AlarmClock.EXTRA_MESSAGE, it) }
            return if (launch(intent)) "Alarm set for %02d:%02d".format(hour, minute) else "ERROR: no clock app accepted the alarm"
        }
    }

    private inner class AddCalendarEvent : Tool {
        override val device = true
        override val name = "add_calendar_event"
        override val description = "Open the calendar's new-event screen pre-filled; the user confirms and saves it. Times are device local time."
        override val parameters = Schema.obj(
            "title" to Schema.str("Event title"),
            "start" to Schema.str("Start, ISO local date-time e.g. 2026-11-20T14:00"),
            "end" to Schema.str("Optional end, ISO local date-time"),
            "location" to Schema.str("Optional location"),
            required = listOf("title", "start"),
        )
        override fun traceLabel(args: JsonObject) = "เพิ่มนัด" to args.str("title").orEmpty()

        override suspend fun run(args: JsonObject, ctx: ResearchContext): String {
            val title = args.str("title") ?: return "ERROR: title is required"
            val zone = ZoneId.systemDefault()
            val start = parseLocal(args.str("start")) ?: return "ERROR: start must look like 2026-11-20T14:00"
            val end = parseLocal(args.str("end"))?.takeIf { it.isAfter(start) } ?: start.plusHours(1)
            val intent = Intent(Intent.ACTION_INSERT)
                .setData(CalendarContract.Events.CONTENT_URI)
                .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start.atZone(zone).toInstant().toEpochMilli())
                .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end.atZone(zone).toInstant().toEpochMilli())
                .putExtra(CalendarContract.Events.TITLE, title)
            args.str("location")?.let { intent.putExtra(CalendarContract.Events.EVENT_LOCATION, it) }
            return if (launch(intent)) "Opened new event screen for \"$title\" — waiting for the user to save" else "ERROR: no calendar app found"
        }

        private fun parseLocal(raw: String?): LocalDateTime? =
            raw?.trim()?.replace(' ', 'T')?.let { runCatching { LocalDateTime.parse(it.take(16)) }.getOrNull() }
    }
}
