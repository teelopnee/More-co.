package com.moreco.paewai;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.WindowInsets;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.nio.charset.StandardCharsets;

/** The full แปะไว้ app (tasks, notes, focus, settings) in one WebView. */
public class MainActivity extends Activity implements Bridge.Owner {
    private static final int REQ_OPEN_FILE = 1;
    private static final int REQ_SAVE_FILE = 2;

    private WebHost host;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingSave;
    private Uri cameraUri; // where the camera writes a photo taken for a note

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.bg));
        host = new WebHost(this, "full", this);
        host.web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                String[] accept = params.getAcceptTypes();
                boolean images = accept != null && accept.length > 0 && accept[0] != null && accept[0].startsWith("image/");
                cameraUri = null;
                Intent pick;
                if (images && params.isCaptureEnabled()) {
                    // "ถ่ายรูป": the camera app saves the photo in the gallery, the note keeps its own copy
                    pick = cameraIntent();
                }
                else if (images) {
                    pick = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
                    if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                } else {
                    pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                }
                try {
                    startActivityForResult(pick, REQ_OPEN_FILE);
                } catch (RuntimeException e) {
                    dropCameraPhoto();
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        root.addView(host.web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
        setContentView(root);
        ReminderReceiver.ensureChannel(this);
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && !Prefs.get(this).getBoolean("askedNotify", false)) {
            Prefs.get(this).edit().putBoolean("askedNotify", true).apply();
            requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 3);
        }
        handle(getIntent());
        SpeechSupport.refresh(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
    }

    /** Opens the camera with a new gallery entry to write to (falls back to the picker without one). */
    private Intent cameraIntent() {
        try {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Images.Media.DISPLAY_NAME, "paewai-" + System.currentTimeMillis() + ".jpg");
            v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            cameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
        } catch (RuntimeException e) {
            cameraUri = null;
        }
        if (cameraUri == null) return new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
        return new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                .putExtra(MediaStore.EXTRA_OUTPUT, cameraUri)
                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
    }

    /** No photo was taken: the empty gallery entry goes away. */
    private void dropCameraPhoto() {
        if (cameraUri == null) return;
        try {
            getContentResolver().delete(cameraUri, null, null);
        } catch (RuntimeException ignored) {
            // nothing to remove
        }
        cameraUri = null;
    }

    /** Pictures shared from another app: copied where the page can read them, then made into a note. */
    private void importImages(ArrayList<Uri> uris, String text) {
        new Thread(() -> {
            File dir = new File(getCacheDir(), "shared");
            dir.mkdirs();
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) if (System.currentTimeMillis() - f.lastModified() > 3_600_000L) f.delete();
            JSONArray urls = new JSONArray();
            long stamp = System.currentTimeMillis();
            for (int i = 0; i < uris.size() && i < 20; i++) {
                File out = new File(dir, "s" + stamp + "n" + i);
                try (InputStream in = getContentResolver().openInputStream(uris.get(i)); OutputStream os = new FileOutputStream(out)) {
                    if (in == null) continue;
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                    urls.put("https://" + WebHost.HOST + "/shared/" + out.getName());
                } catch (Exception e) {
                    out.delete();
                }
            }
            runOnUiThread(() -> host.js(urls.length() == 0
                    ? "window.paewai&&paewai.toast('เปิดรูปที่แชร์มาไม่ได้')"
                    : "window.paewai&&paewai.importImages(" + urls + "," + JSONObject.quote(text == null ? "" : text) + ")"));
        }, "paewai-images").start();
    }

    private void handle(Intent intent) {
        String view = intent.getStringExtra("view");
        if (view != null) host.js("window.paewai&&paewai.show(" + JSONObject.quote(view) + ")");
        String rec = intent.getStringExtra("rec");
        if (rec != null) host.js("window.paewai&&paewai.openRec(" + JSONObject.quote(rec) + ")");
        String type0 = intent.getType();
        if (type0 != null && type0.startsWith("image/") && (Intent.ACTION_SEND.equals(intent.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction()))) {
            ArrayList<Uri> uris = new ArrayList<>();
            if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
                ArrayList<Uri> many = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class) : legacyStreams(intent);
                if (many != null) uris.addAll(many);
            } else {
                Uri one = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : legacyStream(intent);
                if (one != null) uris.add(one);
            }
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            setIntent(new Intent(this, MainActivity.class));
            if (!uris.isEmpty()) importImages(uris, text);
            return;
        }
        // Audio shared from another app (Samsung Voice Recorder, LINE…): keep it and turn it into text.
        if (Intent.ACTION_SEND.equals(intent.getAction()) && intent.getType() != null && intent.getType().startsWith("audio/")) {
            Uri uri = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : legacyStream(intent);
            String type = intent.getType();
            setIntent(new Intent(this, MainActivity.class));
            if (uri != null) {
                new Thread(() -> {
                    String id = RecorderService.importShared(this, uri, type);
                    runOnUiThread(() -> host.js(id == null
                            ? "window.paewai&&paewai.toast('เปิดไฟล์เสียงนี้ไม่ได้')"
                            : "window.paewai&&paewai.openRec(" + JSONObject.quote(id) + ")"));
                }, "paewai-import").start();
            }
        }
    }

    @SuppressWarnings("deprecation")
    private static Uri legacyStream(Intent i) {
        return i.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    @SuppressWarnings("deprecation")
    private static ArrayList<Uri> legacyStreams(Intent i) {
        return i.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // The panel may have changed the data, or notch access may just have been switched on.
        host.js("window.paewai&&paewai.reload()");
    }

    @Override
    public boolean isPanel() {
        return false;
    }

    @Override
    public void dismiss() {
        finish();
    }

    @Override
    public void saveDocument(String name, String text, String mime) {
        saveBytes(name, text.getBytes(StandardCharsets.UTF_8), mime);
    }

    @Override
    public void saveBytes(String name, byte[] bytes, String mime) {
        pendingSave = bytes;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, name);
        try {
            startActivityForResult(i, REQ_SAVE_FILE);
        } catch (RuntimeException e) {
            pendingSave = null;
            host.js("window.paewai&&paewai.toast('เปิดหน้าบันทึกไฟล์ไม่ได้')");
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
        if (requestCode == REQ_OPEN_FILE && fileCallback != null) {
            Uri[] picked = null;
            if (resultCode == RESULT_OK) {
                ClipData clip = data == null ? null : data.getClipData();
                if (clip != null && clip.getItemCount() > 0) {
                    picked = new Uri[clip.getItemCount()];
                    for (int i = 0; i < picked.length; i++) picked[i] = clip.getItemAt(i).getUri();
                } else if (uri != null) picked = new Uri[] {uri};
                else if (cameraUri != null) picked = new Uri[] {cameraUri}; // the camera wrote to the entry made for it
            }
            if (picked == null || (cameraUri != null && picked[0] != cameraUri)) dropCameraPhoto();
            cameraUri = null;
            fileCallback.onReceiveValue(picked);
            fileCallback = null;
        } else if (requestCode == REQ_SAVE_FILE && pendingSave != null) {
            byte[] bytes = pendingSave;
            pendingSave = null;
            if (uri == null) return;
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                out.write(bytes);
                host.js("window.paewai&&paewai.toast('บันทึกไฟล์แล้ว')");
            } catch (Exception e) {
                host.js("window.paewai&&paewai.toast('บันทึกไฟล์ไม่ได้')");
            }
        }
    }
}
