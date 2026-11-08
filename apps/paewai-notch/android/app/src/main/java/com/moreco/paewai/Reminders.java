package com.moreco.paewai;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/** Real alarms for timed tasks and the focus timer, so they ring with the app closed. */
final class Reminders {
    static final String ACTION = "com.moreco.paewai.REMIND";

    private Reminders() {}

    static void schedule(Context c, JSONArray list) {
        if (list == null) list = new JSONArray();
        AlarmManager am = c.getSystemService(AlarmManager.class);
        SharedPreferences prefs = Prefs.get(c);
        Set<String> before = new HashSet<>(prefs.getStringSet("alarmIds", new HashSet<>()));
        Set<String> now = new HashSet<>();
        long time = System.currentTimeMillis();
        long horizon = time + 62L * 24 * 60 * 60 * 1000;
        for (int i = 0; i < list.length() && now.size() < 300; i++) {
            JSONObject r = list.optJSONObject(i);
            if (r == null) continue;
            String id = r.optString("id");
            long at = r.optLong("at");
            if (id.isEmpty() || at <= time || at > horizon) continue;
            PendingIntent pi = pending(c, id, r.optString("title"), r.optString("text"), PendingIntent.FLAG_UPDATE_CURRENT);
            if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
            now.add(id);
        }
        before.removeAll(now);
        for (String id : before) {
            PendingIntent pi = pending(c, id, null, null, PendingIntent.FLAG_NO_CREATE);
            if (pi != null) {
                am.cancel(pi);
                pi.cancel();
            }
        }
        prefs.edit().putStringSet("alarmIds", now).putString("reminders", list.toString()).apply();
    }

    /** After a reboot or an update, alarms are gone: set them again from the saved list. */
    static void restore(Context c) {
        try {
            schedule(c, new JSONArray(Prefs.get(c).getString("reminders", "[]")));
        } catch (Exception ignored) {
            // nothing saved
        }
    }

    private static PendingIntent pending(Context c, String id, String title, String text, int flags) {
        Intent i = new Intent(c, ReminderReceiver.class)
                .setAction(ACTION)
                .setData(Uri.parse("paewai://reminder/" + Uri.encode(id)))
                .putExtra("id", id)
                .putExtra("title", title)
                .putExtra("text", text);
        return PendingIntent.getBroadcast(c, 0, i, flags | PendingIntent.FLAG_IMMUTABLE);
    }
}
