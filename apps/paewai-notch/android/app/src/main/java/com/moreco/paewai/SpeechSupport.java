package com.moreco.paewai;

import android.annotation.TargetApi;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import org.json.JSONObject;

import java.util.List;

/**
 * What the tablet's own speech recognition can do for Thai, for the settings screen:
 * { possible, engine, onDevice, thai: installed|downloading|downloadable|online|none|unknown, refused }.
 * Main thread only.
 */
final class SpeechSupport {
    private SpeechSupport() {}

    static String info(Context c) {
        String saved = Prefs.get(c).getString("sttInfo", null);
        if (saved != null) return saved;
        return base(c).toString();
    }

    private static JSONObject base(Context c) {
        JSONObject o = new JSONObject();
        try {
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("available", SpeechRecognizer.isRecognitionAvailable(c));
            o.put("onDevice", Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(c));
            o.put("refused", Prefs.get(c).getBoolean("sttNoSource", false));
            o.put("possible", Transcriber.possible(c));
            o.put("thai", "unknown");
        } catch (Exception ignored) {
            // JSONObject.put only throws for NaN
        }
        return o;
    }

    static void refresh(Context c) {
        JSONObject o = base(c);
        save(c, o);
        if (Build.VERSION.SDK_INT < 33 || !o.optBoolean("onDevice")) return;
        check(c, o);
    }

    @TargetApi(33)
    private static void check(Context c, JSONObject o) {
        SpeechRecognizer sr;
        try {
            sr = SpeechRecognizer.createOnDeviceSpeechRecognizer(c);
        } catch (RuntimeException e) {
            return;
        }
        final SpeechRecognizer recognizer = sr;
        try {
            recognizer.checkRecognitionSupport(intent(), c.getMainExecutor(), new RecognitionSupportCallback() {
                @Override
                public void onSupportResult(RecognitionSupport s) {
                    String thai = has(s.getInstalledOnDeviceLanguages()) ? "installed"
                            : has(s.getPendingOnDeviceLanguages()) ? "downloading"
                            : has(s.getSupportedOnDeviceLanguages()) ? "downloadable"
                            : has(s.getOnlineLanguages()) ? "online" : "none";
                    try {
                        o.put("thai", thai);
                    } catch (Exception ignored) {
                        // not NaN
                    }
                    save(c, o);
                    recognizer.destroy();
                }

                @Override
                public void onError(int error) {
                    try {
                        o.put("checkError", error);
                    } catch (Exception ignored) {
                        // not NaN
                    }
                    save(c, o);
                    recognizer.destroy();
                }
            });
        } catch (RuntimeException e) {
            recognizer.destroy();
        }
    }

    /** Asks the on-device engine to fetch its Thai model (shows the system's download prompt or runs quietly). */
    @TargetApi(33)
    static boolean download(Context c) {
        if (Build.VERSION.SDK_INT < 33 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(c)) return false;
        try {
            SpeechRecognizer sr = SpeechRecognizer.createOnDeviceSpeechRecognizer(c);
            sr.triggerModelDownload(intent());
            new android.os.Handler(c.getMainLooper()).postDelayed(sr::destroy, 30_000);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** Lets the engine try again (after an update of the speech app, for example). */
    static void reset(Context c) {
        Prefs.get(c).edit().remove("sttNoSource").remove("sttInfo").apply();
        refresh(c);
    }

    private static Intent intent() {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Transcriber.LANG);
        return i;
    }

    private static boolean has(List<String> langs) {
        if (langs == null) return false;
        for (String l : langs) if (l != null && l.toLowerCase(java.util.Locale.ROOT).startsWith("th")) return true;
        return false;
    }

    private static void save(Context c, JSONObject o) {
        Prefs.get(c).edit().putString("sttInfo", o.toString()).apply();
    }
}
