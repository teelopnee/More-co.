package com.moreco.paewai;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
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

    @JavascriptInterface
    public void showKeyboard() {
        ui.post(() -> {
            host.web.requestFocus();
            InputMethodManager imm = activity.getSystemService(InputMethodManager.class);
            if (imm != null) imm.showSoftInput(host.web, InputMethodManager.SHOW_IMPLICIT);
        });
    }

    // ---- voice notes (RecorderService) ------------------------------------------

    /** "ok", or "permission" when the microphone has to be allowed first (the prompt is shown). */
    @JavascriptInterface
    public String recStart() {
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ui.post(() -> activity.requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, 41));
            return "permission";
        }
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

    /** { state: idle|recording|paused, id, elapsedMs, level } */
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
        } catch (Exception ignored) {
            // JSONObject.put only throws for NaN
        }
        return o.toString();
    }

    /** Finished recordings on this tablet: [{ id, at, durationMs, parts, mime }]. */
    @JavascriptInterface
    public String recList() {
        return RecorderService.list(activity).toString();
    }

    /** Where the page can fetch a part of a recording. */
    @JavascriptInterface
    public String recUrl(String id, int part) {
        return WebHost.ORIGIN + "/rec/" + id + "/" + part + ".m4a";
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
