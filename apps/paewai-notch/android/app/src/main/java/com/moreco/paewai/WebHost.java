package com.moreco.paewai;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * A WebView that runs the bundled แปะไว้ web app (assets/web) from an https origin, so ES modules
 * and localStorage work. Both windows (panel and full app) use the same origin, so the same data.
 */
final class WebHost {
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST;

    final WebView web;
    private boolean loaded;
    private final List<String> pending = new ArrayList<>();

    @SuppressLint("SetJavaScriptEnabled")
    WebHost(Activity activity, String mode, Bridge.Owner owner) {
        web = new WebView(activity);
        web.setBackgroundColor(activity.getColor(R.color.bg));
        web.setAlpha(0f);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(activity, this, owner), "PaewaiAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!HOST.equals(url.getHost())) return null;
                return asset(activity, url.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost())) return false;
                try {
                    activity.startActivity(new Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } catch (ActivityNotFoundException ignored) {
                    // nothing can open it
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                loaded = false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                loaded = true;
                web.animate().alpha(1f).setDuration(180).start();
                for (String js : pending) web.evaluateJavascript(js, null);
                pending.clear();
            }
        });
        web.loadUrl(ORIGIN + "/index.html?mode=" + mode);
    }

    /** Runs JavaScript now, or once the page has loaded. */
    void js(String code) {
        if (loaded) web.evaluateJavascript(code, null);
        else pending.add(code);
    }

    private static WebResourceResponse asset(Activity a, String path) {
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        if (path.contains("..")) return notFound();
        try {
            InputStream in = a.getAssets().open("web" + path);
            WebResourceResponse r = new WebResourceResponse(mime(path), mime(path).startsWith("text/") || path.endsWith(".js") || path.endsWith(".webmanifest") ? "utf-8" : null, in);
            r.setResponseHeaders(Collections.singletonMap("Cache-Control", "no-cache"));
            return r;
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", Collections.emptyMap(), null);
    }

    static String mime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        return "application/octet-stream";
    }
}
