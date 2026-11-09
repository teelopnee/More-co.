package com.moreco.paewai;

import android.annotation.TargetApi;
import android.content.Context;
import android.content.Intent;
import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Speech → Thai text with the tablet's own speech recognition (the engine behind voice typing:
 * Samsung's or Google's, on the device when it can), no other AI service and no key.
 *
 * The audio comes from us, not from the microphone: RecorderService records and hands each 100 ms
 * of 16 kHz PCM to {@link #feed} (Android 13+, EXTRA_AUDIO_SOURCE with a segmented session), so
 * recording and transcribing never fight over the microphone. A saved file can be transcribed the
 * same way with {@link #fromFiles}.
 *
 * If the engine does not read audio given to it (some engines only listen to the microphone) the
 * watchdog notices within seconds, gives up, and remembers it so recordings are never put at risk.
 * Other engine errors restart the session; only 8 in a row (nothing heard in between) end it, so
 * hours of recording survive the odd network or engine hiccup.
 *
 * Each run of words remembers where in the audio it started ({@link #times}), so the page can play
 * the recording from a spot in the text.
 */
@TargetApi(33)
final class Transcriber {
    interface Callback {
        void changed(Transcriber t);

        void finished(Transcriber t);
    }

    static final String LANG = "th-TH";
    static final int RATE = 16_000;
    private static final long STALL_MS = 10_000;
    private static final int MAX_ERRORS_IN_A_ROW = 8;
    /** Words are reported a moment after they start: play a little earlier than the first result. */
    private static final long LEAD_MS = 1500;

    private final Context ctx;
    private final boolean fromFile;
    private final Callback cb;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final LinkedBlockingQueue<byte[]> queue;
    private SpeechRecognizer sr;
    private ParcelFileDescriptor readEnd;
    private OutputStream pipe;
    private int generation;
    private volatile boolean finishing;
    private volatile boolean fed; // finish() was called and the writer has sent everything
    private volatile boolean closed;
    private volatile long writeStarted;
    private boolean onDevice;
    private boolean triedOnline;
    private int restarts; // engine errors in a row; any words heard reset it
    private long dropped;
    /** Samples of our audio given to the engine (or dropped when it fell behind) = time in the audio. */
    private final AtomicLong position = new AtomicLong();
    private long segStart = -1; // where the words being heard now started (samples)
    private long lastEnd; // where the last words ended
    /** Where this audio starts in the recording (ms): the part live transcription missed starts later. */
    final long baseMs;
    /** Length of the audio to transcribe (ms), for progress; 0 when unknown. */
    volatile long totalMs;
    private final List<long[]> times = new ArrayList<>();

    private final StringBuilder text = new StringBuilder();
    /** The text so far, safe to read from any thread. */
    private volatile String joined = "";
    volatile String partial = "";
    /** listening | done | unsupported | conflict | failed */
    volatile String state = "starting";

    Transcriber(Context c, boolean fromFile, Callback cb) {
        this(c, fromFile, 0, cb);
    }

    Transcriber(Context c, boolean fromFile, long baseMs, Callback cb) {
        this.ctx = c.getApplicationContext();
        this.fromFile = fromFile;
        this.baseMs = baseMs;
        this.cb = cb;
        // Live: up to 30 s of slack while the engine catches up; a file waits for the engine instead.
        this.queue = new LinkedBlockingQueue<>(fromFile ? 40 : 300);
        this.onDevice = SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx);
    }

    /** Android 13+, a speech engine is installed, and it has not refused audio from us before. */
    static boolean possible(Context c) {
        return android.os.Build.VERSION.SDK_INT >= 33
                && SpeechRecognizer.isRecognitionAvailable(c)
                && !Prefs.get(c).getBoolean("sttNoSource", false);
    }

    void start() {
        main.post(this::open);
        main.postDelayed(watchdog, 1000);
    }

    /** 16 kHz mono PCM. Live audio is dropped (not blocked) if the engine falls far behind. */
    boolean feed(byte[] pcm) {
        if (closed || finishing) return false;
        if (!fromFile) {
            boolean ok = queue.offer(pcm);
            if (!ok) {
                dropped++;
                position.addAndGet(pcm.length / 2); // still part of the recording's timeline
            }
            return ok;
        }
        try {
            while (!closed) if (queue.offer(pcm, 500, TimeUnit.MILLISECONDS)) return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return false;
    }

    /** No more audio: let the engine finish what it has, then report. */
    void finish() {
        finishing = true;
    }

    void cancel() {
        main.post(() -> end("failed"));
    }

    /** How far into the recording the engine has heard (ms). */
    long heardMs() {
        return baseMs + position.get() * 1000 / RATE;
    }

    /** 0..1 for a saved file with a known length, else -1. */
    float progress() {
        long total = totalMs;
        if (total <= 0) return -1;
        return Math.max(0f, Math.min(1f, (heardMs() - baseMs) / (float) total));
    }

    /** "[[character offset, ms], …]" for the text so far. */
    String timesJson() {
        synchronized (times) {
            return Times.format(times);
        }
    }

    String fullText() {
        String j = joined;
        String p = partial;
        if (p == null || p.isEmpty()) return j;
        return j.isEmpty() ? p : j + " " + p;
    }

    // ---- one recognition session ---------------------------------------------------

    private void open() {
        if (closed) return;
        try {
            ParcelFileDescriptor[] p = ParcelFileDescriptor.createPipe();
            readEnd = p[0];
            pipe = new ParcelFileDescriptor.AutoCloseOutputStream(p[1]);
            sr = onDevice ? SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx) : SpeechRecognizer.createSpeechRecognizer(ctx);
            sr.setRecognitionListener(listener);
            sr.startListening(intent());
            state = "listening";
            startWriter(generation, pipe);
            cb.changed(this);
        } catch (Exception e) {
            if (onDevice && !triedOnline) {
                switchToDefault();
                return;
            }
            end("failed");
        }
    }

    private Intent intent() {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, LANG);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.getPackageName());
        i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, readEnd);
        i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
        i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, RATE);
        i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1);
        // One long session that lasts as long as our audio does, with results per segment.
        i.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE);
        return i;
    }

    private void startWriter(int gen, OutputStream out) {
        Thread w = new Thread(() -> {
            try {
                while (!closed && gen == generation) {
                    byte[] b = queue.poll(200, TimeUnit.MILLISECONDS);
                    if (b == null) {
                        if (finishing) {
                            fed = true;
                            break;
                        }
                        continue;
                    }
                    writeStarted = SystemClock.uptimeMillis();
                    out.write(b);
                    writeStarted = 0;
                    position.addAndGet(b.length / 2);
                }
            } catch (Exception ignored) {
                // the engine closed its end (session over): the next session picks up the queue
            } finally {
                writeStarted = 0;
                try {
                    out.close(); // end of audio: the engine wraps up the session
                } catch (IOException ignored) {
                    // already closed
                }
                if (fed && gen == generation) main.postDelayed(() -> end("done"), 20_000);
            }
        }, "paewai-stt");
        w.start();
    }

    /** The engine has not taken audio for a long time: it ignores audio given to it. */
    private final Runnable watchdog = new Runnable() {
        @Override
        public void run() {
            if (closed) return;
            long w = writeStarted;
            if (w != 0 && SystemClock.uptimeMillis() - w > STALL_MS) {
                Prefs.get(ctx).edit().putBoolean("sttNoSource", true).apply();
                end("unsupported");
                return;
            }
            main.postDelayed(this, 1000);
        }
    };

    private void closeSession() {
        generation++;
        if (sr != null) {
            try {
                sr.cancel();
                sr.destroy();
            } catch (RuntimeException ignored) {
                // the engine went away
            }
            sr = null;
        }
        try {
            if (readEnd != null) readEnd.close();
        } catch (IOException ignored) {
            // already closed
        }
        readEnd = null;
        try {
            if (pipe != null) pipe.close();
        } catch (IOException ignored) {
            // already closed
        }
        pipe = null;
    }

    private void restart(long delay) {
        if (closed) return;
        closeSession();
        main.postDelayed(this::open, delay);
    }

    private void switchToDefault() {
        onDevice = false;
        triedOnline = true;
        restart(0);
    }

    /** The microphone was taken by someone else while live: stop, the recording comes first. */
    void conflict() {
        main.post(() -> end("conflict"));
    }

    private void end(String how) {
        if (closed) return;
        closed = true;
        main.removeCallbacks(watchdog);
        closeSession();
        if (!partial.isEmpty()) add(partial);
        state = how;
        queue.clear();
        cb.finished(this);
    }

    private void add(String s) {
        if (s == null || (s = s.trim()).isEmpty()) return;
        long start = segStart >= 0 ? segStart : lastEnd;
        long ms = baseMs + Math.max(0, start * 1000 / RATE - LEAD_MS);
        int offset = text.length() == 0 ? 0 : text.length() + 1;
        synchronized (times) {
            long last = times.isEmpty() ? 0 : times.get(times.size() - 1)[1];
            times.add(new long[] {offset, Math.max(last, ms)});
        }
        if (text.length() > 0) text.append(' ');
        text.append(s);
        joined = text.toString();
        partial = "";
        segStart = -1;
        lastEnd = position.get();
        restarts = 0; // the engine works: count errors afresh
        cb.changed(this);
    }

    private void sessionEnded() {
        if (closed) return;
        if (finishing && (fed || queue.isEmpty())) end("done");
        else restart(200);
    }

    private static String first(Bundle b) {
        if (b == null) return null;
        ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return r != null && !r.isEmpty() ? r.get(0) : null;
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override
        public void onReadyForSpeech(Bundle params) {
            // listening
        }

        @Override
        public void onBeginningOfSpeech() {
            // speech started
        }

        @Override
        public void onRmsChanged(float rms) {
            // level not needed here
        }

        @Override
        public void onBufferReceived(byte[] buffer) {
            // not used
        }

        @Override
        public void onEndOfSpeech() {
            // a segment ended; results follow
        }

        @Override
        public void onEvent(int type, Bundle params) {
            // engine-specific
        }

        @Override
        public void onPartialResults(Bundle b) {
            String s = first(b);
            if (s == null) return;
            if (partial.isEmpty()) segStart = position.get();
            partial = s;
            cb.changed(Transcriber.this);
        }

        @Override
        public void onSegmentResults(Bundle b) {
            add(first(b));
        }

        @Override
        public void onEndOfSegmentedSession() {
            sessionEnded();
        }

        @Override
        public void onResults(Bundle b) {
            add(first(b));
            sessionEnded();
        }

        @Override
        public void onError(int error) {
            if (closed) return;
            switch (error) {
                case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
                case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE:
                    // No Thai on the device (yet): try the engine's regular mode once.
                    if (onDevice && !triedOnline) switchToDefault();
                    else end("unsupported");
                    break;
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                    end("failed");
                    break;
                case SpeechRecognizer.ERROR_NO_MATCH:
                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                    if (finishing && (fed || queue.isEmpty())) end("done");
                    else restart(150);
                    break;
                default:
                    if (finishing && (fed || queue.isEmpty())) end("done");
                    else if (++restarts <= MAX_ERRORS_IN_A_ROW) restart(Math.min(10_000, 1200L * restarts));
                    else end("failed");
            }
        }
    };

    // ---- saved files ------------------------------------------------------------------

    /** Transcribes saved audio files in order (any format Android can decode), from `fromMs` on. */
    static Transcriber fromFiles(Context c, List<File> files, long fromMs, long totalMs, Callback cb) {
        Transcriber t = new Transcriber(c, true, fromMs, cb);
        t.totalMs = Math.max(0, totalMs - fromMs);
        t.start();
        Thread decode = new Thread(() -> {
            long[] skip = {fromMs * RATE / 1000};
            try {
                for (File f : files) {
                    if (t.closed) break;
                    decode(f, t, skip);
                }
            } catch (Exception ignored) {
                // a broken file: transcribe what was decoded
            } finally {
                t.finish();
            }
        }, "paewai-decode");
        decode.start();
        return t;
    }

    private static void decode(File f, Transcriber t, long[] skip) throws Exception {
        MediaExtractor ex = new MediaExtractor();
        MediaCodec dec = null;
        try {
            ex.setDataSource(f.getPath());
            int track = -1;
            MediaFormat fmt = null;
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat m = ex.getTrackFormat(i);
                String mime = m.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    track = i;
                    fmt = m;
                    break;
                }
            }
            if (track < 0) return;
            ex.selectTrack(track);
            dec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME));
            dec.configure(fmt, null, null, 0);
            dec.start();
            Pcm.To16k.Sink sink = chunk -> {
                byte[] rest = Pcm.skip(chunk, skip);
                if (rest != null && !t.feed(rest)) throw new IllegalStateException("stopped");
            };
            Pcm.To16k resample = new Pcm.To16k(fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE), fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT), sink);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inputDone = false;
            while (!t.closed) {
                if (!inputDone) {
                    int in = dec.dequeueInputBuffer(10_000);
                    if (in >= 0) {
                        ByteBuffer b = dec.getInputBuffer(in);
                        int n = b == null ? -1 : ex.readSampleData(b, 0);
                        if (n < 0) {
                            dec.queueInputBuffer(in, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            dec.queueInputBuffer(in, 0, n, ex.getSampleTime(), 0);
                            ex.advance();
                        }
                    }
                }
                int out = dec.dequeueOutputBuffer(info, 10_000);
                if (out == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat of = dec.getOutputFormat();
                    resample.flush();
                    resample = new Pcm.To16k(of.getInteger(MediaFormat.KEY_SAMPLE_RATE), of.getInteger(MediaFormat.KEY_CHANNEL_COUNT), sink);
                } else if (out >= 0) {
                    ByteBuffer b = dec.getOutputBuffer(out);
                    if (b != null && info.size > 0) {
                        byte[] pcm = new byte[info.size];
                        b.position(info.offset);
                        b.get(pcm, 0, info.size);
                        resample.push(pcm, pcm.length);
                    }
                    dec.releaseOutputBuffer(out, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break;
                }
            }
            resample.flush();
        } finally {
            if (dec != null) {
                try {
                    dec.stop();
                } catch (RuntimeException ignored) {
                    // not started
                }
                dec.release();
            }
            ex.release();
        }
    }
}
