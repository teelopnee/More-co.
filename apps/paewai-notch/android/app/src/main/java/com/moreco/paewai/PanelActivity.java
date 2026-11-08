package com.moreco.paewai;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Insets;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.animation.AccelerateInterpolator;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;
import android.animation.ValueAnimator;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.lang.ref.WeakReference;

/**
 * The card that drops down from the notch over whatever app is open. It is kept alive in the
 * background (moveTaskToBack) so the next tap on the pill opens it instantly.
 */
public class PanelActivity extends Activity implements Bridge.Owner {
    private static final int SCRIM = 0x38000000;
    private static WeakReference<PanelActivity> current = new WeakReference<>(null);
    private static boolean shown;

    private WebHost host;
    private FrameLayout root;
    private FrameLayout card;
    private boolean closing;
    /** Opened by a notification button: no keyboard this time. */
    private boolean quiet;
    private int topInset;
    private int bottomInset;

    static void toggle(Context c) {
        PanelActivity p = current.get();
        if (shown && p != null) p.dismiss();
        else c.startActivity(new Intent(c, PanelActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        current = new WeakReference<>(this);
        float dp = getResources().getDisplayMetrics().density;

        root = new FrameLayout(this);
        root.setBackgroundColor(SCRIM);
        root.setOnClickListener(v -> dismiss());

        card = new FrameLayout(this);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(getColor(R.color.bg));
        bg.setCornerRadius(30 * dp);
        card.setBackground(bg);
        card.setClipToOutline(true);
        card.setElevation(18 * dp);
        card.setClickable(true);

        host = new WebHost(this, "panel", this);
        card.addView(host.web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        root.addView(card, new FrameLayout.LayoutParams(1, 1, Gravity.TOP | Gravity.CENTER_HORIZONTAL));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets top = insets.getInsets(WindowInsets.Type.statusBars() | WindowInsets.Type.displayCutout());
            Insets bottom = insets.getInsets(WindowInsets.Type.ime() | WindowInsets.Type.navigationBars());
            topInset = top.top;
            bottomInset = bottom.bottom;
            layoutCard();
            return WindowInsets.CONSUMED;
        });
        root.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
            if (r - l != or - ol || b - t != ob - ot) layoutCard();
        });
        setContentView(root);
        handle(getIntent());
        enter();
    }

    private void layoutCard() {
        float dp = getResources().getDisplayMetrics().density;
        int w = root.getWidth();
        int h = root.getHeight();
        if (w == 0 || h == 0) return;
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) card.getLayoutParams();
        int width = Math.min(w - Math.round(24 * dp), Math.round(620 * dp));
        int top = Math.max(topInset, Math.round(8 * dp)) + Math.round(6 * dp);
        int height = Math.min(h - top - bottomInset - Math.round(12 * dp), Math.round(760 * dp));
        if (lp.width == width && lp.height == height && lp.topMargin == top) return;
        lp.width = width;
        lp.height = Math.max(height, Math.round(200 * dp));
        lp.topMargin = top;
        card.setLayoutParams(lp);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
        enter();
    }

    /** Text shared from another app goes straight into กล่องรับ; reminder buttons snooze or tick off. */
    private void handle(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (ReminderReceiver.ACTION_SNOOZE.equals(action) || ReminderReceiver.ACTION_DONE.equals(action)) {
            String id = intent.getStringExtra(ReminderReceiver.EXTRA_ID);
            if (id == null) return;
            getSystemService(NotificationManager.class).cancel(ReminderReceiver.notificationId(id));
            String call = ReminderReceiver.ACTION_SNOOZE.equals(action) ? "snooze" : "done";
            host.js("window.paewai&&paewai." + call + "(" + JSONObject.quote(id) + ")");
            quiet = true;
            setIntent(new Intent(this, PanelActivity.class));
            return;
        }
        if (!Intent.ACTION_SEND.equals(action)) return;
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        String all = ((subject == null ? "" : subject + " ") + (text == null ? "" : text)).trim();
        if (!all.isEmpty()) host.js("window.paewai&&paewai.addShared(" + JSONObject.quote(all) + ")");
    }

    @Override
    protected void onResume() {
        super.onResume();
        shown = true;
        if (quiet) {
            quiet = false;
            host.js("window.paewai&&paewai.reload()");
            return;
        }
        host.js("window.paewai&&(paewai.reload(),paewai.focusCapture())");
        root.postDelayed(() -> new Bridge(this, host, this).showKeyboard(), 180);
    }

    @Override
    protected void onPause() {
        super.onPause();
        shown = false;
    }

    private void enter() {
        closing = false;
        card.setPivotY(0);
        card.post(() -> {
            card.setPivotX(card.getWidth() / 2f);
            card.setScaleX(0.3f);
            card.setScaleY(0.12f);
            card.setTranslationY(-12 * getResources().getDisplayMetrics().density);
            card.setAlpha(0f);
            card.animate().scaleX(1f).scaleY(1f).translationY(0f).setDuration(340).setInterpolator(new OvershootInterpolator(0.9f)).start();
            card.animate().alpha(1f).setDuration(140);
        });
        fadeScrim(0, SCRIM >>> 24, 220);
    }

    private void fadeScrim(int fromAlpha, int toAlpha, long ms) {
        ValueAnimator a = ValueAnimator.ofInt(fromAlpha, toAlpha);
        a.setDuration(ms);
        a.addUpdateListener(v -> root.setBackgroundColor(((int) v.getAnimatedValue()) << 24));
        a.start();
    }

    @Override
    public boolean isPanel() {
        return true;
    }

    /** Shrinks back into the notch and goes to the background, keeping the page warm. */
    @Override
    public void dismiss() {
        if (closing) return;
        closing = true;
        View focus = getCurrentFocus();
        if (focus != null) focus.clearFocus();
        card.setPivotX(card.getWidth() / 2f);
        fadeScrim(SCRIM >>> 24, 0, 170);
        card.animate().scaleX(0.3f).scaleY(0.12f).alpha(0f).setDuration(170).setInterpolator(new AccelerateInterpolator(1.4f)).withEndAction(() -> {
            moveTaskToBack(true);
            if (Build.VERSION.SDK_INT >= 34) overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, 0, 0);
            else overridePendingTransition(0, 0);
        }).start();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        dismiss();
    }

    @Override
    public void saveDocument(String name, String text, String mime) {
        new Bridge(this, host, this).shareText(text);
    }

    @Override
    protected void onDestroy() {
        if (current.get() == this) current = new WeakReference<>(null);
        host.web.destroy();
        super.onDestroy();
    }
}
