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
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaMetadataRetriever;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Records voice notes like the tablet's own recorder: a foreground service (microphone type), so
 * it keeps going with the screen off or in another app, with pause/stop in its notification and a
 * red dot on the notch pill.
 *
 * The microphone is read as 16 kHz PCM, encoded to AAC (.aac, playable even if cut off), and the
 * same audio goes to the tablet's own speech recognition (Transcriber), so the Thai text is ready
 * when recording stops — no other AI service. If that path cannot start, MediaRecorder records
 * instead (no live text). A new file every 25 minutes.
 *
 * Made to last for hours, like the recorders it is modelled on:
 * - a partial wake lock keeps the CPU reading the microphone with the screen off;
 * - a phone or video call silences other apps' microphones: the recording pauses itself and goes
 *   on when the call ends (marked in the notification);
 * - it will not start with less than 50 MB free and stops, saved, below 20 MB;
 * - if live transcription gives up halfway, the part it missed is transcribed from the file after
 *   recording stops, and appended;
 * - bookmarks (from the page or the notification) mark moments to come back to.
 * Transcribing a saved file runs in this service too, in the foreground with its progress, so it
 * keeps going when the app is closed.
 */
public class RecorderService extends Service {
    static final String START = "com.moreco.paewai.REC_START";
    static final String PAUSE = "com.moreco.paewai.REC_PAUSE";
    static final String RESUME = "com.moreco.paewai.REC_RESUME";
    static final String STOP = "com.moreco.paewai.REC_STOP";
    static final String MARK = "com.moreco.paewai.REC_MARK";
    /** Keep the process alive while saved recordings are being transcribed. */
    static final String KEEP = "com.moreco.paewai.KEEP";
    static final long MIN_FREE_START = 50L << 20;
    static final long MIN_FREE_KEEP = 20L << 20;
    static final String CHANNEL = "recording";
    static final String CHANNEL_DONE = "recording-done";
    private static final int NOTE_ID = 7001;
    private static final int DONE_ID = 7002;
    static final int RATE = Transcriber.RATE;
    static final long PART_MS = 25 * 60_000L;
    /** File types a part can have (recorded here, recorded by an older version, or shared in). */
    static final String[] EXTS = {"aac", "m4a", "mp3", "wav", "ogg", "opus", "flac", "3gp", "amr", "webm"};

    // The recording in progress (written on the main thread, read by the web bridge and the pill).
    static volatile String id;
    static volatile long startedAt;
    static volatile long runStart;
    static volatile long elapsedBefore;
    static volatile boolean paused;
    static volatile int parts;
    static volatile float level;
    static volatile Transcriber live;
    /** Bookmarks of the recording in progress (ms into it). */
    static final List<Long> marks = Collections.synchronizedList(new ArrayList<>());
    /** Paused by a call, not by the person: goes on by itself when the call ends. */
    static volatile boolean autoPaused;
    /** Transcriptions of saved recordings that are running: id → transcriber. */
    static final Map<String, Transcriber> jobs = new HashMap<>();

    private static RecorderService instance;
    private Capture capture;
    private MediaRecorder fallback;
    private String mime = "audio/aac";
    private String sttState = "";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private long lastMetaWrite;
    private PowerManager.WakeLock wake;
    /** ms into the recording where live transcription stopped working (-1: it did not). */
    private long sttGapFrom = -1;
    private String liveTimesSoFar = "[]";
    private boolean jobsForeground;

    static boolean recording() {
        return id != null;
    }

    static long elapsed() {
        return elapsedBefore + (id != null && !paused ? SystemClock.elapsedRealtime() - runStart : 0);
    }

    /** Microphone level 0..1 for the waveform. */
    static float level() {
        RecorderService s = instance;
        if (s == null || paused) return 0;
        if (s.fallback != null) {
            try {
                return Math.min(1f, s.fallback.getMaxAmplitude() / 32767f);
            } catch (RuntimeException e) {
                return 0;
            }
        }
        return level;
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

    /** The file of part n, whatever its type, or null. */
    static File part(Context c, String recId, int n) {
        for (String ext : EXTS) {
            File f = new File(dir(c), recId + "-" + n + "." + ext);
            if (f.exists()) return f;
        }
        return null;
    }

    static File newPart(Context c, String recId, int n, String ext) {
        return new File(dir(c), recId + "-" + n + "." + ext);
    }

    static File meta(Context c, String recId) {
        return new File(dir(c), recId + ".json");
    }

    static int countParts(Context c, String recId) {
        int n = 0;
        while (true) {
            File f = part(c, recId, n);
            if (f == null || f.length() < 512) break;
            n++;
        }
        return n;
    }

    static List<File> partFiles(Context c, String recId) {
        List<File> out = new ArrayList<>();
        for (int n = 0; ; n++) {
            File f = part(c, recId, n);
            if (f == null) break;
            out.add(f);
        }
        return out;
    }

    static JSONObject readMeta(Context c, String recId) {
        try {
            return new JSONObject(new String(java.nio.file.Files.readAllBytes(meta(c, recId).toPath()), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
    }

    static void write(File f, JSONObject o) throws Exception {
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(o.toString().getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        }
        if (!tmp.renameTo(f)) throw new IllegalStateException("rename");
    }

    /** Finished recordings, oldest first: [{ id, at, durationMs, parts, mime, transcript, stt }]. */
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
                    if ("listening".equals(o.optString("stt"))) o.put("stt", "done");
                    write(f, o);
                }
                Transcriber job = jobs.get(recId);
                if (job != null) {
                    o.put("stt", "running");
                    if (!o.optBoolean("appending")) o.put("transcript", job.fullText());
                    o.put("progress", (double) job.progress());
                }
                if (o.optInt("parts") > 0) out.put(o);
            } catch (Exception ignored) {
                // unreadable: skip
            }
        }
        return out;
    }

    static void delete(Context c, String recId) {
        if (!validId(recId) || recId.equals(id)) return;
        Transcriber job = jobs.remove(recId);
        if (job != null) job.cancel();
        for (File f : partFiles(c, recId)) f.delete();
        meta(c, recId).delete();
    }

    static String newId() {
        return "a" + Long.toString(System.currentTimeMillis(), 36) + Integer.toString((int) (Math.random() * 1296), 36);
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
            o.put("mime", mime);
            o.put("done", done);
            Transcriber t = live;
            o.put("transcript", t != null ? t.fullText() : liveTextSoFar);
            o.put("times", new JSONArray(t != null ? t.timesJson() : liveTimesSoFar));
            o.put("stt", t != null ? t.state : sttState);
            synchronized (marks) {
                o.put("marks", new JSONArray(marks));
            }
            if (sttGapFrom >= 0) o.put("sttGapFrom", sttGapFrom);
            write(meta(this, recId), o);
            lastMetaWrite = SystemClock.uptimeMillis();
        } catch (Exception ignored) {
            // the audio files are still there
        }
    }

    /** Changes one saved recording's details (its text, mostly). */
    static void updateMeta(Context c, String recId, java.util.function.Consumer<JSONObject> change) {
        JSONObject o = readMeta(c, recId);
        if (o == null) return;
        try {
            change.accept(o);
            write(meta(c, recId), o);
        } catch (Exception ignored) {
            // keep the old file
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
        releaseWake();
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
        else if (MARK.equals(action)) mark();
        else if (KEEP.equals(action)) onKeep();
        else if (id == null && live == null && closing == null && jobs.isEmpty()) stopSelf();
        return START_NOT_STICKY;
    }

    /** Android 15+: a media-processing service may run 6 hours a day; after that, carry on unprotected. */
    @Override
    public void onTimeout(int startId, int fgsType) {
        jobsForeground = false;
        if (id == null) stopForeground(STOP_FOREGROUND_REMOVE);
    }

    private void mark() {
        if (id == null) return;
        marks.add(elapsed());
        writeMeta(false);
        changed();
    }

    private void holdWake() {
        try {
            if (wake == null) {
                wake = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "paewai:recording");
                wake.setReferenceCounted(false);
            }
            wake.acquire(12 * 3600_000L);
        } catch (RuntimeException ignored) {
            // recording still works, the screen-off part depends on the device
        }
    }

    private void releaseWake() {
        try {
            if (wake != null && wake.isHeld()) wake.release();
        } catch (RuntimeException ignored) {
            // released
        }
    }

    /** A phone or video call (or the ringing before it) has the microphone. */
    private boolean inCall() {
        try {
            int mode = getSystemService(AudioManager.class).getMode();
            return mode != AudioManager.MODE_NORMAL && mode != AudioManager.MODE_INVALID && mode != AudioManager.MODE_CURRENT;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private void autoPause(boolean on) {
        if (id == null) return;
        if (on && !paused) {
            pause();
            autoPaused = true;
            changed();
        } else if (!on && autoPaused && paused) {
            resume();
        }
    }

    /** Free space for recordings, in bytes. */
    static long free(Context c) {
        return dir(c).getUsableSpace();
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
        String newId = newId();
        startedAt = System.currentTimeMillis();
        // Foreground first: Android allows the microphone only to a visible app or a foreground service.
        try {
            startForeground(NOTE_ID, build(0, false), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } catch (RuntimeException e) {
            stopSelf();
            return;
        }
        if (free(this) < MIN_FREE_START) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            notifyText(this, null, "พื้นที่ในเครื่องเหลือน้อย", "ต้องมีที่ว่างอย่างน้อย 50 MB จึงจะอัดเสียงได้ ลบไฟล์ที่ไม่ใช้แล้วลองอีกครั้ง");
            stopSelf();
            return;
        }
        sttState = "";
        sttGapFrom = -1;
        liveTextSoFar = "";
        liveTimesSoFar = "[]";
        marks.clear();
        autoPaused = false;
        try {
            capture = new Capture(newId);
            mime = "audio/aac";
        } catch (Exception e) {
            capture = null;
            if (!startFallback(newId)) {
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
                return;
            }
        }
        id = newId;
        runStart = SystemClock.elapsedRealtime();
        elapsedBefore = 0;
        paused = false;
        parts = 1;
        holdWake();
        if (capture != null) {
            capture.start();
            startLive();
        } else sttState = "unavailable";
        writeMeta(false);
        changed();
    }

    /** MediaRecorder: always works, no live text. */
    private boolean startFallback(String recId) {
        MediaRecorder r = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : legacyRecorder();
        try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC);
            r.setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS);
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            r.setAudioChannels(1);
            r.setAudioSamplingRate(44_100);
            r.setAudioEncodingBitRate(64_000);
            r.setOutputFile(newPart(this, recId, 0, "aac"));
            r.setOnErrorListener((mr, what, extra) -> stopRecording());
            r.prepare();
            r.start();
        } catch (Exception e) {
            r.release();
            return false;
        }
        fallback = r;
        mime = "audio/aac";
        return true;
    }

    @SuppressWarnings("deprecation")
    private static MediaRecorder legacyRecorder() {
        return new MediaRecorder();
    }

    private void startLive() {
        if (!Transcriber.possible(this)) {
            sttState = "unavailable";
            return;
        }
        live = new Transcriber(this, false, new Transcriber.Callback() {
            @Override
            public void changed(Transcriber t) {
                // Keep the text on disk every few seconds, in case the app is killed.
                if (id != null && SystemClock.uptimeMillis() - lastMetaWrite > 5000) writeMeta(false);
            }

            @Override
            public void finished(Transcriber t) {
                onLiveFinished(t);
            }
        });
        live.start();
    }

    private void onLiveFinished(Transcriber t) {
        if (t == closing) {
            // The recording has stopped and the engine has said its last words.
            final String recId = closingId;
            final String text = t.fullText();
            closing = null;
            closingId = null;
            final String times = t.timesJson();
            updateMeta(this, recId, o -> {
                try {
                    if (!text.isEmpty() || o.optString("transcript").isEmpty()) {
                        o.put("transcript", text);
                        o.put("times", new JSONArray(times));
                    }
                    o.put("stt", t.state);
                } catch (Exception ignored) {
                    // not NaN
                }
            });
            done(recId);
            return;
        }
        if (t != live) return;
        // Ended while still recording (engine refused, or the microphone was taken): keep recording.
        live = null;
        sttState = t.state;
        String text = t.fullText();
        if (!text.isEmpty()) {
            liveTextSoFar = text;
            liveTimesSoFar = t.timesJson();
        }
        // The engine worked and then gave up: the rest is transcribed from the file afterwards.
        if (("failed".equals(t.state) || "conflict".equals(t.state)) && sttGapFrom < 0) sttGapFrom = Math.min(elapsed(), t.heardMs());
        writeMeta(false);
        changed();
    }

    /** Text from a live session that ended early, kept for the saved recording. */
    private String liveTextSoFar = "";
    /** The previous recording's transcriber, finishing its last words. */
    private Transcriber closing;
    private String closingId;

    private void pause() {
        if (id == null || paused) return;
        if (fallback != null) {
            try {
                fallback.pause();
            } catch (RuntimeException e) {
                return;
            }
        }
        elapsedBefore = elapsed();
        paused = true;
        writeMeta(false);
        changed();
    }

    private void resume() {
        if (id == null || !paused) return;
        if (fallback != null) {
            try {
                fallback.resume();
            } catch (RuntimeException e) {
                return;
            }
        }
        runStart = SystemClock.elapsedRealtime();
        paused = false;
        autoPaused = false;
        changed();
    }

    private void stopRecording() {
        String recId = id;
        if (recId == null) {
            if (live == null && jobs.isEmpty()) stopSelf();
            return;
        }
        long length = elapsed();
        if (capture != null) {
            capture.finish();
            try {
                capture.join(3000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            capture = null;
        }
        if (fallback != null) {
            try {
                fallback.stop();
            } catch (RuntimeException ignored) {
                // stopped right after starting: nothing was written
            }
            fallback.release();
            fallback = null;
        }
        elapsedBefore = length;
        paused = true;
        releaseWake();
        Transcriber t = live;
        writeMeta(true);
        liveTextSoFar = "";
        liveTimesSoFar = "[]";
        long gap = t == null ? sttGapFrom : -1;
        sttGapFrom = -1;
        id = null;
        paused = false;
        autoPaused = false;
        level = 0;
        if (countParts(this, recId) == 0) {
            delete(this, recId);
            live = null;
            if (t != null) t.cancel();
            stopForeground(STOP_FOREGROUND_REMOVE);
            changed();
            stopSelf();
            return;
        }
        if (t != null) {
            // Let the speech engine finish the last words (a few seconds), then report.
            live = null;
            closing = t;
            closingId = recId;
            getSystemService(NotificationManager.class).notify(NOTE_ID, savingNote());
            t.finish();
            handler.postDelayed(() -> {
                if (closing == t) t.cancel();
            }, 30_000);
            changed();
            return;
        }
        // Live transcription stopped halfway: transcribe the rest from the file, then add it.
        if (gap >= 0 && gap < length - 1000 && Transcriber.possible(this)) startJob(this, recId, gap, true);
        done(recId);
    }

    private void done(String recId) {
        if (id == null && jobs.isEmpty()) stopForeground(STOP_FOREGROUND_REMOVE);
        JSONObject m = readMeta(this, recId);
        notifyDone(recId, m != null ? m.optLong("durationMs") : 0, m != null && !m.optString("transcript").isEmpty());
        changed();
        if (!jobs.isEmpty()) keepForJobs();
        if (id == null && live == null && closing == null && jobs.isEmpty()) stopSelf();
    }

    // ---- reading the microphone ------------------------------------------------------

    private final class Capture extends Thread {
        private final String recId;
        private final AudioRecord ar;
        private AacWriter out;
        private volatile boolean stop;
        private int part;
        private long partSamples;
        private int zeroMs;
        private boolean heard;
        private int reads;

        Capture(String recId) throws Exception {
            super("paewai-capture");
            this.recId = recId;
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) throw new SecurityException("microphone");
            int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (min <= 0) throw new IllegalStateException("16 kHz not supported");
            AudioRecord a = new AudioRecord(MediaRecorder.AudioSource.MIC, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min * 4, RATE * 2));
            if (a.getState() != AudioRecord.STATE_INITIALIZED) {
                a.release();
                throw new IllegalStateException("AudioRecord");
            }
            try {
                out = new AacWriter(newPart(RecorderService.this, recId, 0, "aac"), RATE, 48_000);
            } catch (Exception e) {
                a.release();
                throw e;
            }
            ar = a;
        }

        void finish() {
            stop = true;
        }

        @Override
        public void run() {
            byte[] buf = new byte[RATE / 10 * 2]; // 100 ms
            try {
                ar.startRecording();
                while (!stop) {
                    int n = ar.read(buf, 0, buf.length);
                    if (n == AudioRecord.ERROR_DEAD_OBJECT) break;
                    if (n <= 0) continue;
                    level = Pcm.peak(buf, n);
                    if (++reads % 10 == 0) {
                        // Once a second: a call takes the microphone (we would record silence) → pause till it ends.
                        boolean call = inCall();
                        if (call && !paused) handler.post(() -> autoPause(true));
                        else if (!call && autoPaused) handler.post(() -> autoPause(false));
                        // Every 30 seconds: stop, saved, before the storage is full.
                        if (reads % 300 == 0 && free(RecorderService.this) < MIN_FREE_KEEP) {
                            handler.post(() -> {
                                notifyText(RecorderService.this, null, "หยุดอัดเพราะพื้นที่ในเครื่องใกล้เต็ม", "บันทึกส่วนที่อัดได้ไว้แล้ว");
                                stopRecording();
                            });
                            break;
                        }
                    }
                    if (paused) continue;
                    out.write(buf, n);
                    partSamples += n / 2;
                    Transcriber t = live;
                    if (t != null) {
                        t.feed(Arrays.copyOf(buf, n));
                        // Another app took the microphone: we get exact silence. Recording comes first.
                        if (Pcm.silent(buf, n)) {
                            zeroMs += 100;
                            if (heard && zeroMs >= 2000 && !inCall()) {
                                Prefs.get(RecorderService.this).edit().putBoolean("sttNoSource", true).apply();
                                t.conflict();
                            }
                        } else {
                            zeroMs = 0;
                            heard = true;
                        }
                    }
                    if (partSamples >= PART_MS / 1000 * RATE) {
                        out.close();
                        part++;
                        partSamples = 0;
                        out = new AacWriter(newPart(RecorderService.this, recId, part, "aac"), RATE, 48_000);
                        parts = part + 1;
                        handler.post(() -> writeMeta(false));
                    }
                }
            } catch (Exception e) {
                handler.post(RecorderService.this::stopRecording);
            } finally {
                try {
                    ar.stop();
                } catch (RuntimeException ignored) {
                    // never started
                }
                ar.release();
                try {
                    out.close();
                } catch (Exception ignored) {
                    // what was written stays
                }
            }
        }
    }

    // ---- transcribing saved recordings ------------------------------------------------

    /** "ok" | "running" | "unsupported" | "missing" */
    static String transcribeSaved(Context c, String recId) {
        if (!validId(recId) || recId.equals(id)) return "missing";
        if (jobs.containsKey(recId)) return "running";
        if (!Transcriber.possible(c)) return "unsupported";
        if (partFiles(c, recId).isEmpty()) return "missing";
        startJob(c, recId, 0, false);
        return "ok";
    }

    /**
     * Transcribes a saved recording from `fromMs`; `append` adds the text after what it has (the part
     * live transcription missed), otherwise it replaces it.
     */
    static void startJob(Context c, String recId, long fromMs, boolean append) {
        List<File> files = partFiles(c, recId);
        if (files.isEmpty() || jobs.containsKey(recId)) return;
        Context app = c.getApplicationContext();
        JSONObject meta = readMeta(app, recId);
        long total = meta != null ? meta.optLong("durationMs") : 0;
        if (append) {
            updateMeta(app, recId, o -> {
                try {
                    o.put("appending", true);
                } catch (Exception ignored) {
                    // not NaN
                }
            });
        }
        Transcriber t = Transcriber.fromFiles(app, files, fromMs, total, new Transcriber.Callback() {
            @Override
            public void changed(Transcriber t) {
                // read through list()
            }

            @Override
            public void finished(Transcriber t) {
                jobs.remove(recId);
                final String text = t.fullText();
                final List<long[]> times = Times.parse(t.timesJson());
                updateMeta(app, recId, o -> {
                    try {
                        String before = o.optString("transcript");
                        if (append && !text.isEmpty()) {
                            List<long[]> merged = Times.append(Times.parse(String.valueOf(o.optJSONArray("times"))), before.length(), times);
                            o.put("transcript", before.isEmpty() ? text : before + " " + text);
                            o.put("times", new JSONArray(Times.format(merged)));
                        } else if (!append && (!text.isEmpty() || before.isEmpty())) {
                            o.put("transcript", text);
                            o.put("times", new JSONArray(Times.format(times)));
                        }
                        o.remove("appending");
                        o.remove("sttGapFrom");
                        o.put("stt", t.state);
                    } catch (Exception ignored) {
                        // keep the old file
                    }
                });
                RecorderService s = instance;
                if (s != null) s.handler.post(s::jobsChanged);
                notifyText(app, recId, append ? "ถอดช่วงที่ขาดเสร็จแล้ว" : "ถอดเสียงเสร็จแล้ว", text.isEmpty() ? "ไม่ได้ยินเสียงพูดในไฟล์นี้" : "แตะเพื่อดูข้อความ สรุป และมายด์แมป");
            }
        });
        jobs.put(recId, t);
        // Keep the process alive (and show progress) while it runs, also with the app closed.
        RecorderService s = instance;
        if (s != null) s.handler.post(s::keepForJobs);
        else {
            try {
                c.startForegroundService(intent(c, KEEP));
            } catch (RuntimeException ignored) {
                // runs while the app is open
            }
        }
    }

    private final Runnable jobTicker = new Runnable() {
        @Override
        public void run() {
            if (jobs.isEmpty() || id != null) return;
            getSystemService(NotificationManager.class).notify(NOTE_ID, jobNote());
            handler.postDelayed(this, 2000);
        }
    };

    private static int jobType() {
        return Build.VERSION.SDK_INT >= 35 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING : ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
    }

    /** Started with startForegroundService(KEEP): it must go to the foreground right away, jobs or not. */
    private void onKeep() {
        ensureChannels(this);
        if (id == null) {
            try {
                startForeground(NOTE_ID, jobNote(), jobType());
                jobsForeground = true;
            } catch (RuntimeException ignored) {
                // not allowed now: it still runs while the app is open
            }
        }
        keepForJobs();
    }

    /** In the foreground while saved recordings are transcribed (the recording's own notification covers it otherwise). */
    private void keepForJobs() {
        if (jobs.isEmpty()) {
            jobsChanged();
            return;
        }
        if (id != null) return;
        ensureChannels(this);
        if (!jobsForeground) {
            try {
                startForeground(NOTE_ID, jobNote(), jobType());
                jobsForeground = true;
            } catch (RuntimeException ignored) {
                // not allowed now: it still runs while the app is open
            }
        }
        handler.removeCallbacks(jobTicker);
        handler.post(jobTicker);
    }

    private void jobsChanged() {
        if (!jobs.isEmpty()) return;
        handler.removeCallbacks(jobTicker);
        if (id == null) {
            jobsForeground = false;
            stopForeground(STOP_FOREGROUND_REMOVE);
            if (live == null && closing == null) stopSelf();
        }
    }

    private Notification jobNote() {
        float p = -1;
        for (Transcriber t : jobs.values()) p = Math.max(p, t.progress());
        Notification.Builder b = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setContentTitle("กำลังถอดเสียงเป็นข้อความ…")
                .setContentText(p >= 0 ? "แปะไว้ · " + Math.round(p * 100) + "% · ปิดแอปได้ ทำต่อให้เอง" : "แปะไว้ · ปิดแอปได้ ทำต่อให้เอง")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_PROGRESS);
        if (p >= 0) b.setProgress(100, Math.round(p * 100), false);
        else b.setProgress(0, 0, true);
        return b.build();
    }

    /** Audio shared from another app (e.g. Samsung Voice Recorder) becomes a recording here. */
    static String importShared(Context c, Uri uri, String type) {
        String ext = extFor(type, uri);
        String recId = newId();
        File f = newPart(c, recId, 0, ext);
        try (InputStream in = c.getContentResolver().openInputStream(uri); OutputStream out = new FileOutputStream(f)) {
            if (in == null) return null;
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } catch (Exception e) {
            f.delete();
            return null;
        }
        long duration = 0;
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        try {
            mmr.setDataSource(f.getPath());
            String d = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (d != null) duration = Long.parseLong(d);
        } catch (Exception ignored) {
            // unknown length
        } finally {
            try {
                mmr.release();
            } catch (Exception ignored) {
                // released
            }
        }
        try {
            JSONObject o = new JSONObject();
            o.put("id", recId);
            o.put("at", System.currentTimeMillis());
            o.put("durationMs", duration);
            o.put("parts", 1);
            o.put("mime", type != null && type.startsWith("audio/") ? type : "audio/" + ext);
            o.put("done", true);
            o.put("shared", true);
            o.put("transcript", "");
            o.put("stt", "");
            write(meta(c, recId), o);
        } catch (Exception e) {
            f.delete();
            return null;
        }
        transcribeSaved(c, recId);
        return recId;
    }

    static String extFor(String type, Uri uri) {
        String t = type == null ? "" : type.toLowerCase(Locale.ROOT);
        if (t.contains("aac")) return "aac";
        if (t.contains("mp4") || t.contains("m4a")) return "m4a";
        if (t.contains("mpeg") || t.contains("mp3")) return "mp3";
        if (t.contains("wav")) return "wav";
        if (t.contains("ogg")) return "ogg";
        if (t.contains("opus")) return "opus";
        if (t.contains("flac")) return "flac";
        if (t.contains("3gp")) return "3gp";
        if (t.contains("amr")) return "amr";
        if (t.contains("webm")) return "webm";
        String path = uri == null ? "" : String.valueOf(uri.getLastPathSegment()).toLowerCase(Locale.ROOT);
        for (String ext : EXTS) if (path.endsWith("." + ext)) return ext;
        return "m4a";
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
            ch.setDescription("บอกเมื่อบันทึกเสียงแล้ว แตะเพื่อดูข้อความที่ถอดได้");
            ch.setSound(null, null);
            nm.createNotificationChannel(ch);
        }
    }

    private Notification build(long length, boolean isPaused) {
        Intent open = new Intent(this, MainActivity.class).putExtra("view", "notes").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent openPi = PendingIntent.getActivity(this, 11, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent toggle = PendingIntent.getService(this, 12, intent(this, isPaused ? RESUME : PAUSE), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 13, intent(this, STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        boolean texting = live != null;
        int n = marks.size();
        String pins = n > 0 ? " · ปักหมุด " + n + " จุด" : "";
        Notification.Builder b = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setContentTitle(autoPaused ? "พักไว้ระหว่างสาย" : isPaused ? "พักการอัดเสียง" : "กำลังอัดเสียง")
                .setContentText(autoPaused
                        ? "แปะไว้ · " + clock(length) + " · วางสายแล้วจะอัดต่อเอง"
                        : isPaused ? "แปะไว้ · " + clock(length) + pins : (texting ? "แปะไว้ · กำลังถอดเป็นข้อความไปด้วย" : "แปะไว้ · แตะหยุดเมื่อเสร็จ") + pins)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .setContentIntent(openPi)
                .addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_stat_mic), isPaused ? "อัดต่อ" : "พัก", toggle).build());
        if (!isPaused) {
            PendingIntent markPi = PendingIntent.getService(this, 14, intent(this, MARK), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            b.addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_stat_mic), "ปักหมุด", markPi).build());
        }
        b.addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_stat_mic), "หยุดและบันทึก", stop).build());
        if (!isPaused) b.setUsesChronometer(true).setWhen(System.currentTimeMillis() - length).setShowWhen(true);
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    private Notification savingNote() {
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setContentTitle("กำลังเก็บข้อความที่ถอดได้…")
                .setContentText("แปะไว้ · อีกไม่กี่วินาที")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .build();
    }

    private void showNotification() {
        if (id == null) return;
        getSystemService(NotificationManager.class).notify(NOTE_ID, build(elapsed(), paused));
    }

    private void notifyDone(String recId, long length, boolean hasText) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        Intent open = new Intent(this, MainActivity.class).putExtra("rec", recId).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(this, recId.hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, CHANNEL_DONE)
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setContentTitle("บันทึกเสียงแล้ว · " + clock(length))
                .setContentText(hasText ? "ถอดเป็นข้อความแล้ว แตะเพื่อดู สรุป หรือทำมายด์แมป" : "แตะเพื่อฟังและถอดเป็นข้อความ")
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        getSystemService(NotificationManager.class).notify(DONE_ID, n);
    }

    /** A one-off note (low storage, a transcription finished); `recId` opens that recording. */
    static void notifyText(Context c, String recId, String title, String text) {
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        ensureChannels(c);
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (recId != null) open.putExtra("rec", recId);
        else open.putExtra("view", "notes");
        PendingIntent pi = PendingIntent.getActivity(c, recId != null ? recId.hashCode() + 1 : 15, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(c, CHANNEL_DONE)
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        c.getSystemService(NotificationManager.class).notify(recId != null ? DONE_ID + 1 : DONE_ID + 2, n);
    }

    /** Everyone that shows the recording state: notification, Quick Settings tile, notch pill. */
    private void changed() {
        if (id != null) showNotification();
        RecordTile.refresh(this);
        NotchService.refreshIfRunning();
    }

    static String clock(long ms) {
        long s = Math.max(0, ms / 1000);
        return s >= 3600
                ? String.format(Locale.ROOT, "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
                : String.format(Locale.ROOT, "%d:%02d", s / 60, s % 60);
    }
}
