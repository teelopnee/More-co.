package com.moreco.paewai;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;

/**
 * Records voice notes like the phone's own recorder: a foreground service (microphone type), so
 * it keeps going with the screen off or in another app, with pause/stop in its notification and a
 * red dot on the notch pill. Audio is AAC in .m4a files, a new file every ~25 minutes so each part
 * can be sent for transcription on its own. The web app lists, plays and transcribes them.
 */
public class RecorderService extends Service {
    static final String START = "com.moreco.paewai.REC_START";
    static final String PAUSE = "com.moreco.paewai.REC_PAUSE";
    static final String RESUME = "com.moreco.paewai.REC_RESUME";
    static final String STOP = "com.moreco.paewai.REC_STOP";
    static final String CHANNEL = "recording";
    static final String CHANNEL_DONE = "recording-done";
    private static final int NOTE_ID = 7001;
    private static final int DONE_ID = 7002;
    /** 64 kbit/s ≈ 25 minutes per 12 MB file. */
    static final long PART_BYTES = 12_000_000L;

    // The recording in progress (written on the main thread, read by the web bridge and the pill).
    static volatile String id;
    static volatile long startedAt;
    static volatile long runStart;
    static volatile long elapsedBefore;
    static volatile boolean paused;
    static volatile int parts;

    private static RecorderService instance;
    private MediaRecorder rec;
    private final Handler handler = new Handler(Looper.getMainLooper());

    static boolean recording() {
        return id != null;
    }

    static long elapsed() {
        return elapsedBefore + (id != null && !paused ? SystemClock.elapsedRealtime() - runStart : 0);
    }

    /** Microphone level 0..1 for the waveform. */
    static float level() {
        RecorderService s = instance;
        if (s == null || s.rec == null || paused) return 0;
        try {
            return Math.min(1f, s.rec.getMaxAmplitude() / 32767f);
        } catch (RuntimeException e) {
            return 0;
        }
    }

    static Intent intent(Context c, String action) {
        return new Intent(c, RecorderService.class).setAction(action);
    }

    // ---- files ------------------------------------------------------------------

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "recordings");
        if (!d.isDirectory()) d.mkdirs();
        return d;
    }

    static boolean validId(String s) {
        return s != null && s.matches("[a-z0-9]{4,40}");
    }

    static File part(Context c, String recId, int n) {
        return new File(dir(c), recId + "-" + n + ".m4a");
    }

    static File meta(Context c, String recId) {
        return new File(dir(c), recId + ".json");
    }

    /** Finished recordings, oldest first: [{ id, at, durationMs, parts, mime }]. */
    static JSONArray list(Context c) {
        JSONArray out = new JSONArray();
        File[] files = dir(c).listFiles((d, name) -> name.endsWith(".json"));
        if (files == null) return out;
        Arrays.sort(files, (a, b) -> a.getName().compareTo(b.getName()));
        for (File f : files) {
            try {
                JSONObject o = new JSONObject(new String(java.nio.file.Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
                String recId = o.optString("id");
                if (recId.equals(id)) continue; // still recording
                if (!o.optBoolean("done")) {
                    // Cut off (the app was killed): keep the parts that can still be played.
                    o.put("parts", countParts(c, recId));
                    o.put("done", true);
                    write(f, o);
                }
                if (o.optInt("parts") > 0) out.put(o);
            } catch (Exception ignored) {
                // unreadable: skip
            }
        }
        return out;
    }

    static int countParts(Context c, String recId) {
        int n = 0;
        while (part(c, recId, n).length() > 1024) n++;
        return n;
    }

    static void delete(Context c, String recId) {
        if (!validId(recId) || recId.equals(id)) return;
        for (int n = 0; n < 200; n++) {
            File f = part(c, recId, n);
            if (!f.exists()) break;
            f.delete();
        }
        meta(c, recId).delete();
    }

    private static void write(File f, JSONObject o) throws Exception {
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(o.toString().getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        }
        if (!tmp.renameTo(f)) throw new IllegalStateException("rename");
    }

    private void writeMeta(boolean done) {
        String recId = id;
        if (recId == null) return;
        try {
            JSONObject o = new JSONObject();
            o.put("id", recId);
            o.put("at", startedAt);
            o.put("durationMs", elapsed());
            o.put("parts", done ? countParts(this, recId) : parts);
            o.put("mime", "audio/mp4");
            o.put("done", done);
            write(meta(this, recId), o);
        } catch (Exception ignored) {
            // the audio files are still there
        }
    }

    // ---- service ----------------------------------------------------------------

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public void onDestroy() {
        if (id != null) stopRecording();
        instance = null;
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (START.equals(action)) start();
        else if (PAUSE.equals(action)) pause();
        else if (RESUME.equals(action)) resume();
        else if (STOP.equals(action)) stopRecording();
        else if (id == null) stopSelf();
        return START_NOT_STICKY;
    }

    private void start() {
        ensureChannels(this);
        if (id != null) {
            showNotification();
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            stopSelf();
            return;
        }
        String newId = "a" + Long.toString(System.currentTimeMillis(), 36) + Integer.toString((int) (Math.random() * 1296), 36);
        startedAt = System.currentTimeMillis();
        // Foreground first: Android allows the microphone only to a visible app or a foreground service.
        try {
            startForeground(NOTE_ID, build(newId, 0, false), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } catch (RuntimeException e) {
            stopSelf();
            return;
        }
        MediaRecorder r = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
        try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC);
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            r.setAudioChannels(1);
            r.setAudioSamplingRate(44_100);
            r.setAudioEncodingBitRate(64_000);
            r.setOutputFile(part(this, newId, 0));
            r.setMaxFileSize(PART_BYTES);
            r.setOnInfoListener((mr, what, extra) -> {
                if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_APPROACHING) nextPart();
                else if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) stopRecording();
            });
            r.setOnErrorListener((mr, what, extra) -> stopRecording());
            r.prepare();
            r.start();
        } catch (Exception e) {
            r.release();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return;
        }
        rec = r;
        id = newId;
        runStart = SystemClock.elapsedRealtime();
        elapsedBefore = 0;
        paused = false;
        parts = 1;
        writeMeta(false);
        changed();
    }

    private void nextPart() {
        if (rec == null || id == null) return;
        try {
            rec.setNextOutputFile(part(this, id, parts));
            parts++;
            writeMeta(false);
        } catch (Exception ignored) {
            // the current file simply ends at its limit
        }
    }

    private void pause() {
        if (rec == null || paused) return;
        try {
            rec.pause();
        } catch (RuntimeException e) {
            return;
        }
        elapsedBefore = elapsed();
        paused = true;
        writeMeta(false);
        changed();
    }

    private void resume() {
        if (rec == null || !paused) return;
        try {
            rec.resume();
        } catch (RuntimeException e) {
            return;
        }
        runStart = SystemClock.elapsedRealtime();
        paused = false;
        changed();
    }

    private void stopRecording() {
        String done = id;
        if (done == null) {
            stopSelf();
            return;
        }
        long length = elapsed();
        if (rec != null) {
            try {
                rec.stop();
            } catch (RuntimeException ignored) {
                // stopped right after starting: nothing was written
            }
            rec.release();
            rec = null;
        }
        elapsedBefore = length;
        paused = true;
        writeMeta(true);
        id = null;
        paused = false;
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (countParts(this, done) > 0) notifyDone(done, length);
        else delete(this, done);
        changed();
        stopSelf();
    }

    // ---- notification, tile, pill ---------------------------------------------------

    static void ensureChannels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "กำลังอัดเสียง", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("แสดงตลอดเวลาที่แปะไว้อัดเสียง พร้อมปุ่มพักและหยุด");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CHANNEL_DONE) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_DONE, "อัดเสียงเสร็จ", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("บอกเมื่อบันทึกเสียงแล้ว แตะเพื่อถอดความและสรุป");
            ch.setSound(null, null);
            nm.createNotificationChannel(ch);
        }
    }

    private Notification build(String recId, long length, boolean isPaused) {
        Intent open = new Intent(this, MainActivity.class).putExtra("view", "notes").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent openPi = PendingIntent.getActivity(this, 11, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent toggle = PendingIntent.getService(this, 12, intent(this, isPaused ? RESUME : PAUSE), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 13, intent(this, STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setContentTitle(isPaused ? "พักการอัดเสียง" : "กำลังอัดเสียง")
                .setContentText(isPaused ? "แปะไว้ · " + clock(length) : "แปะไว้ · แตะหยุดเมื่อเสร็จ")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .setContentIntent(openPi)
                .addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_stat_mic), isPaused ? "อัดต่อ" : "พัก", toggle).build())
                .addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_stat_mic), "หยุดและบันทึก", stop).build());
        if (!isPaused) b.setUsesChronometer(true).setWhen(System.currentTimeMillis() - length).setShowWhen(true);
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    private void showNotification() {
        if (id == null) return;
        getSystemService(NotificationManager.class).notify(NOTE_ID, build(id, elapsed(), paused));
    }

    private void notifyDone(String recId, long length) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        Intent open = new Intent(this, MainActivity.class).putExtra("rec", recId).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(this, recId.hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, CHANNEL_DONE)
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setContentTitle("บันทึกเสียงแล้ว · " + clock(length))
                .setContentText("แตะเพื่อฟัง ถอดความ และสรุปเป็นมายด์แมป")
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        getSystemService(NotificationManager.class).notify(DONE_ID, n);
    }

    /** Everyone that shows the recording state: notification, Quick Settings tile, notch pill. */
    private void changed() {
        if (id != null) showNotification();
        RecordTile.refresh(this);
        NotchService.refreshIfRunning();
        handler.removeCallbacksAndMessages(null);
    }

    static String clock(long ms) {
        long s = Math.max(0, ms / 1000);
        return s >= 3600
                ? String.format(Locale.ROOT, "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
                : String.format(Locale.ROOT, "%d:%02d", s / 60, s % 60);
    }
}
