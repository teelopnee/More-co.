package com.moreco.paewai;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** The full แปะไว้ app (tasks, notes, focus, settings) in one WebView. */
public class MainActivity extends Activity implements Bridge.Owner {
    private static final int REQ_OPEN_FILE = 1;
    private static final int REQ_SAVE_FILE = 2;

    private WebHost host;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingSave;

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
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try {
                    startActivityForResult(pick, REQ_OPEN_FILE);
                } catch (RuntimeException e) {
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
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
    }

    private void handle(Intent intent) {
        String view = intent.getStringExtra("view");
        if (view != null) host.js("window.paewai&&paewai.show(" + JSONObject.quote(view) + ")");
        String rec = intent.getStringExtra("rec");
        if (rec != null) host.js("window.paewai&&paewai.openRec(" + JSONObject.quote(rec) + ")");
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
            fileCallback.onReceiveValue(uri == null ? null : new Uri[] {uri});
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
