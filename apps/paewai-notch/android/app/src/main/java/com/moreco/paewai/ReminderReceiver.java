package com.moreco.paewai;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.drawable.Icon;
import android.os.Build;

public class ReminderReceiver extends BroadcastReceiver {
    static final String CHANNEL = "reminders";
    /** Notification buttons: open the drop-down panel, which tells the page what to do. */
    static final String ACTION_SNOOZE = "com.moreco.paewai.SNOOZE";
    static final String ACTION_DONE = "com.moreco.paewai.DONE";
    static final String EXTRA_ID = "id";

    @Override
    public void onReceive(Context c, Intent intent) {
        String title = intent.getStringExtra("title");
        String text = intent.getStringExtra("text");
        String id = intent.getStringExtra("id");
        if (title == null) title = "แปะไว้";
        if (text == null) text = "";
        NotchService.flashIfRunning(text.isEmpty() ? title : title + " · " + text);
        notify(c, id, title, text);
    }

    static void ensureChannel(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "ถึงเวลา", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("เตือนเรื่องที่แปะไว้เมื่อถึงเวลา และเมื่อครบเวลาโฟกัส");
        nm.createNotificationChannel(ch);
    }

    private static void notify(Context c, String id, String title, String text) {
        if (Build.VERSION.SDK_INT >= 33
                && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        ensureChannel(c);
        Intent open = new Intent(c, PanelActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_note)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setCategory(Notification.CATEGORY_REMINDER)
                .setContentIntent(pi)
                .setAutoCancel(true);
        if (id != null && !id.equals("focus")) {
            b.addAction(action(c, id, ACTION_SNOOZE, "เลื่อน 10 นาที"));
            b.addAction(action(c, id, ACTION_DONE, "เสร็จแล้ว"));
        }
        c.getSystemService(NotificationManager.class).notify(notificationId(id), b.build());
    }

    static int notificationId(String id) {
        return id == null ? 0 : id.hashCode();
    }

    private static Notification.Action action(Context c, String id, String what, String label) {
        Intent i = new Intent(c, PanelActivity.class).setAction(what).putExtra(EXTRA_ID, id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(c, (what + id).hashCode(), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_stat_note), label, pi).build();
    }
}
