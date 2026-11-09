package com.moreco.paewai;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.CalendarContract;
import android.provider.Settings;
import android.util.Base64;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

/** window.PaewaiAndroid in the web app. Methods run on a background thread. */
final class Bridge {
    interface Owner {
        boolean isPanel();

        void dismiss();

        void saveDocument(String name, String text, String mime);

        /** A binary file (a mind map picture). The panel has no file picker of its own. */
        default void saveBytes(String name, byte[] bytes, String mime) {
        }
    }

    private final Activity activity;
    private final WebHost host;
    private final Owner owner;
    private final Handler ui = new Handler(Looper.getMainLooper());

    Bridge(Activity activity, WebHost host, Owner owner) {
        this.activity = activity;
        this.host = host;
        this.owner = owner;
    }

    @JavascriptInterface
    public String info() {
        JSONObject o = new JSONObject();
        try {
            o.put("notch", NotchService.isEnabled(activity));
            o.put("pill", Prefs.pillEnabled(activity));
            o.put("hideFullscreen", Prefs.hideFullscreen(activity));
            o.put("version", BuildConfig.VERSION_NAME);
            o.put("panel", owner.isPanel());
        } catch (Exception ignored) {
            // JSONObject.put only throws for NaN
        }
        return o.toString();
    }

    /** The web app's summary: open task days, the focus timer, reminders to schedule. */
    @JavascriptInterface
    public void sync(String json) {
        Prefs.saveSummary(activity, json);
        try {
            Reminders.schedule(activity, new JSONObject(json).optJSONArray("reminders"));
        } catch (Exception ignored) {
            // bad JSON: keep the old alarms
        }
        ui.post(NotchService::refreshIfRunning);
    }

    @JavascriptInterface
    public void setPill(boolean on) {
        Prefs.get(activity).edit().putBoolean("pill", on).apply();
        ui.post(NotchService::refreshIfRunning);
    }

    @JavascriptInterface
    public void setHideFullscreen(boolean on) {
        Prefs.get(activity).edit().putBoolean("hideFullscreen", on).apply();
        ui.post(NotchService::refreshIfRunning);
    }

    @JavascriptInterface
    public void openNotchSettings() {
        start(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
    }

    @JavascriptInterface
    public void openAppInfo() {
        start(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + activity.getPackageName())));
    }

    @JavascriptInterface
    public void close() {
        ui.post(owner::dismiss);
    }

    @JavascriptInterface
    public void openFull(String view) {
        ui.post(() -> {
            Intent i = new Intent(activity, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (view != null && !view.isEmpty()) i.putExtra("view", view);
            activity.startActivity(i);
            if (owner.isPanel()) owner.dismiss();
        });
    }

    /** Opens Samsung Calendar (or any calendar) with a new event filled in. */
    @JavascriptInterface
    public boolean addToCalendar(String title, double begin, double end, boolean allDay) {
        Intent i = new Intent(Intent.ACTION_INSERT)
                .setData(CalendarContract.Events.CONTENT_URI)
                .putExtra(CalendarContract.Events.TITLE, title)
                .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, (long) begin)
                .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, (long) end)
                .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, allDay)
                .putExtra(CalendarContract.Events.HAS_ALARM, 1);
        return start(i);
    }

    @JavascriptInterface
    public void saveText(String name, String text, String mime) {
        ui.post(() -> owner.saveDocument(name, text, mime));
    }

    @JavascriptInterface
    public void shareText(String text) {
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
        start(Intent.createChooser(send, null));
    }

    @JavascriptInterface
    public boolean copyText(String text) {
        ClipboardManager cm = activity.getSystemService(ClipboardManager.class);
        if (cm == null) return false;
        cm.setPrimaryClip(ClipData.newPlainText("แปะไว้", text));
        return true;
    }

    /** The copied text, for an answer brought back from Claude (Android lets only the app in front read it). */
    @JavascriptInterface
    public String readClipboard() {
        ClipboardManager cm = activity.getSystemService(ClipboardManager.class);
        if (cm == null || !cm.hasPrimaryClip()) return "";
        ClipData clip = cm.getPrimaryClip();
        if (clip == null || clip.getItemCount() == 0) return "";
        CharSequence text = clip.getItemAt(0).coerceToText(activity);
        return text == null ? "" : text.toString();
    }

    @JavascriptInterface
    public void showKeyboard() {
        ui.post(() -> {
            host.web.requestFocus();
            InputMethodManager imm = activity.getSystemService(InputMethodManager.class);
            if (imm != null) imm.showSoftInput(host.web, InputMethodManager.SHOW_IMPLICIT);
        });
    }

    // ---- voice notes (RecorderService) ------------------------------------------

    /** "ok", "permission" when the microphone has to be allowed first (the prompt is shown), "storage" when the tablet is nearly full. */
    @JavascriptInterface
    public String recStart() {
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ui.post(() -> activity.requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, 41));
            return "permission";
        }
        if (RecorderService.free(activity) < RecorderService.MIN_FREE_START) return "storage";
        try {
            activity.startForegroundService(RecorderService.intent(activity, RecorderService.START));
            return "ok";
        } catch (RuntimeException e) {
            return "error";
        }
    }

    @JavascriptInterface
    public void recPause() {
        send(RecorderService.PAUSE);
    }

    @JavascriptInterface
    public void recResume() {
        send(RecorderService.RESUME);
    }

    @JavascriptInterface
    public void recStop() {
        send(RecorderService.STOP);
    }

    /** A bookmark at this moment of the recording. */
    @JavascriptInterface
    public void recMark() {
        send(RecorderService.MARK);
    }

    /**
     * Whether long recordings with the screen off are safe from battery saving:
     * { ignoring: exempt from battery optimization, samsung, freeMb }.
     */
    @JavascriptInterface
    public String batteryInfo() {
        JSONObject o = new JSONObject();
        try {
            PowerManager pm = activity.getSystemService(PowerManager.class);
            o.put("ignoring", pm != null && pm.isIgnoringBatteryOptimizations(activity.getPackageName()));
            o.put("samsung", "samsung".equalsIgnoreCase(Build.MANUFACTURER));
            o.put("freeMb", RecorderService.free(activity) >> 20);
        } catch (Exception ignored) {
            // JSONObject.put only throws for NaN
        }
        return o.toString();
    }

    /** Asks to leave แปะไว้ out of battery optimization (or opens the list when that is not possible). */
    @JavascriptInterface
    public boolean batterySettings() {
        Intent ask = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + activity.getPackageName()));
        return start(ask) || start(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
    }

    /** { state: idle|recording|paused, id, elapsedMs, level, stt, text (the last words), partial } */
    @JavascriptInterface
    public String recState() {
        JSONObject o = new JSONObject();
        try {
            String id = RecorderService.id;
            o.put("state", id == null ? "idle" : RecorderService.paused ? "paused" : "recording");
            o.put("id", id == null ? "" : id);
            o.put("at", RecorderService.startedAt);
            o.put("elapsedMs", RecorderService.elapsed());
            o.put("level", RecorderService.level());
            Transcriber t = RecorderService.live;
            o.put("stt", t != null ? t.state : "off");
            String text = t != null ? t.fullText() : "";
            o.put("text", text.length() > 400 ? text.substring(text.length() - 400) : text);
            o.put("words", text.length());
            o.put("marks", RecorderService.marks.size());
            o.put("call", RecorderService.autoPaused);
        } catch (Exception ignored) {
            // JSONObject.put only throws for NaN
        }
        return o.toString();
    }

    /** Thai speech recognition on this tablet (no other AI): see SpeechSupport. */
    @JavascriptInterface
    public String sttInfo() {
        return SpeechSupport.info(activity);
    }

    @JavascriptInterface
    public void sttRefresh() {
        ui.post(() -> SpeechSupport.refresh(activity));
    }

    @JavascriptInterface
    public boolean sttDownload() {
        java.util.concurrent.atomic.AtomicBoolean ok = new java.util.concurrent.atomic.AtomicBoolean();
        java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
        ui.post(() -> {
            ok.set(SpeechSupport.download(activity));
            done.countDown();
        });
        try {
            done.await(3, java.util.concurrent.TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return ok.get();
    }

    @JavascriptInterface
    public void sttReset() {
        ui.post(() -> SpeechSupport.reset(activity));
    }

    /** Transcribes a saved recording with the tablet's own speech recognition: "ok" | "running" | "unsupported" | "missing". */
    @JavascriptInterface
    public String recTranscribe(String id) {
        java.util.concurrent.atomic.AtomicReference<String> res = new java.util.concurrent.atomic.AtomicReference<>("missing");
        java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
        ui.post(() -> {
            res.set(RecorderService.transcribeSaved(activity, id));
            done.countDown();
        });
        try {
            done.await(3, java.util.concurrent.TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return res.get();
    }

    /** Finished recordings on this tablet: [{ id, at, durationMs, parts, mime }]. */
    @JavascriptInterface
    public String recList() {
        return RecorderService.list(activity).toString();
    }

    /** Where the page can fetch a part of a recording. */
    @JavascriptInterface
    public String recUrl(String id, int part) {
        java.io.File f = RecorderService.validId(id) ? RecorderService.part(activity, id, part) : null;
        String name = f == null ? part + ".aac" : f.getName().substring(f.getName().indexOf('-') + 1);
        return WebHost.ORIGIN + "/rec/" + id + "/" + name;
    }

    @JavascriptInterface
    public void recDelete(String id) {
        RecorderService.delete(activity, id);
    }

    @JavascriptInterface
    public void saveBase64(String name, String data, String mime) {
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            ui.post(() -> owner.saveBytes(name, bytes, mime));
        } catch (IllegalArgumentException ignored) {
            // not base64
        }
    }

    private void send(String action) {
        try {
            activity.startService(RecorderService.intent(activity, action));
        } catch (RuntimeException ignored) {
            // the service is gone
        }
    }

    private boolean start(Intent i) {
        try {
            if (!(activity instanceof MainActivity) || owner.isPanel()) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(i);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        }
    }
}
