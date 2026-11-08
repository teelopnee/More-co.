package com.moreco.paewai;

import android.accessibilityservice.AccessibilityService;
import android.animation.ValueAnimator;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextPaint;
import android.util.TypedValue;
import android.view.Display;
import android.view.DisplayCutout;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.animation.PathInterpolator;

import org.json.JSONObject;

import java.util.List;
import java.util.Locale;

/**
 * Draws the pill over the camera cut-out, above the status bar, in every app.
 * It is an accessibility service only because that is the one kind of window Android lets an
 * app place over the status bar. It reads nothing on screen (canRetrieveWindowContent=false).
 */
public class NotchService extends AccessibilityService {
    static NotchService instance;

    /** How far the pill reaches past each side of the camera, per state (dp). */
    private static final float WING_IDLE = 12;
    private static final float WING_COUNT = 34;
    private static final float WING_TIMER = 52;
    private static final float WING_PAUSED = 40;
    /** One UI basic motion curve. */
    private static final PathInterpolator ONE_UI = new PathInterpolator(0.22f, 0.25f, 0f, 1f);

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WindowManager wm;
    private PillView pill;
    private WindowManager.LayoutParams lp;
    private PillGeometry geometry;
    private float wing = WING_IDLE;
    private float targetWing = WING_IDLE;
    private float extra;
    private boolean sawStatusBar;
    private boolean statusBarHidden;
    private boolean flashing;
    private ValueAnimator animator;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            long next = updateContent();
            handler.postDelayed(this, next);
        }
    };

    private final Runnable endFlash = this::collapse;

    static boolean isEnabled(Context c) {
        String list = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (list == null) return false;
        ComponentName me = new ComponentName(c, NotchService.class);
        for (String part : list.split(":")) {
            if (me.equals(ComponentName.unflattenFromString(part))) return true;
        }
        return false;
    }

    /** Called after the web app saves: redraw the content, show or hide the pill. */
    static void refreshIfRunning() {
        NotchService s = instance;
        if (s != null) s.refresh();
    }

    static void flashIfRunning(String text) {
        NotchService s = instance;
        if (s != null) s.flash(text);
    }

    @Override
    public void onCreate() {
        // Services get a light default theme; ours follows day/night so nothing gets "force-darkened".
        setTheme(R.style.Theme_Paewai);
        super.onCreate();
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        wm = getSystemService(WindowManager.class);
        refresh();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Nothing to do: the service exists to own the overlay window.
    }

    @Override
    public void onInterrupt() {}

    @Override
    public boolean onUnbind(Intent intent) {
        removePill();
        instance = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        removePill();
        instance = null;
        super.onDestroy();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Rotation: the cut-out moves to another edge. Wait for the display to settle.
        handler.postDelayed(this::relayout, 300);
    }

    void refresh() {
        if (!Prefs.pillEnabled(this)) {
            removePill();
            return;
        }
        if (pill == null) addPill();
        applyVisibility();
        handler.removeCallbacks(tick);
        handler.post(tick);
    }

    private void addPill() {
        pill = new PillView(this);
        pill.setListener(new PillView.Listener() {
            @Override
            public void onOpen() {
                collapse();
                PanelActivity.toggle(NotchService.this);
            }

            @Override
            public void onLongPress() {
                collapse();
                startActivity(new Intent(NotchService.this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
        });
        pill.setOnApplyWindowInsetsListener((v, insets) -> {
            boolean visible = insets.isVisible(WindowInsets.Type.statusBars());
            if (visible) sawStatusBar = true;
            // Only trust "hidden" after having seen the bar, so a device that never reports it
            // still shows the pill.
            boolean hidden = sawStatusBar && !visible;
            if (hidden != statusBarHidden) {
                statusBarHidden = hidden;
                handler.post(this::applyVisibility);
            }
            return insets;
        });
        lp = new WindowManager.LayoutParams(
                1, 1,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.LEFT;
        lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
        lp.setFitInsetsTypes(0);
        lp.setTitle("แปะไว้");
        updateContent();
        wing = targetWing;
        setShape(wing, 0);
        try {
            wm.addView(pill, lp);
        } catch (RuntimeException e) {
            pill = null;
        }
    }

    private void removePill() {
        handler.removeCallbacks(tick);
        handler.removeCallbacks(endFlash);
        if (animator != null) animator.cancel();
        if (pill != null) {
            try {
                wm.removeViewImmediate(pill);
            } catch (RuntimeException ignored) {
                // already gone
            }
            pill = null;
        }
    }

    private PillGeometry computeGeometry(float wingDp) {
        Rect bounds = wm.getMaximumWindowMetrics().getBounds();
        float density = getResources().getDisplayMetrics().density;
        return PillGeometry.compute(bounds.width(), bounds.height(), cutoutRect(), density, Math.round(wingDp));
    }

    private int[] cutoutRect() {
        DisplayCutout cutout = null;
        try {
            Display d = getSystemService(DisplayManager.class).getDisplay(Display.DEFAULT_DISPLAY);
            if (d != null) cutout = d.getCutout();
        } catch (RuntimeException ignored) {
            // fall through
        }
        if (cutout == null) cutout = wm.getMaximumWindowMetrics().getWindowInsets().getDisplayCutout();
        if (cutout == null) return null;
        List<Rect> rects = cutout.getBoundingRects();
        for (Rect r : rects) {
            if (!r.isEmpty()) return new int[] {r.left, r.top, r.right, r.bottom};
        }
        return null;
    }

    private void relayout() {
        if (pill == null) return;
        if (animator != null) animator.cancel();
        flashing = false;
        pill.setMessage(null);
        wing = targetWing;
        setShape(wing, 0);
        applyVisibility();
    }

    /** Lays the window out for a wing size and an extra depth (reminder message). */
    private void setShape(float wingDp, float extraPx) {
        wing = wingDp;
        extra = extraPx;
        geometry = computeGeometry(wingDp);
        int add = geometry.vertical() ? 0 : Math.round(extraPx);
        lp.x = geometry.x;
        lp.y = geometry.y;
        lp.width = geometry.width;
        lp.height = geometry.height + add;
        pill.setShape(geometry, add);
        update();
    }

    private void animateShape(float toWing, float toExtra, long ms) {
        if (pill == null) return;
        if (animator != null) animator.cancel();
        float fromWing = wing, fromExtra = extra;
        if (Math.abs(fromWing - toWing) < 0.5f && Math.abs(fromExtra - toExtra) < 0.5f) return;
        animator = ValueAnimator.ofFloat(0f, 1f);
        animator.setDuration(ms);
        animator.setInterpolator(ONE_UI);
        animator.addUpdateListener(a -> {
            float f = (float) a.getAnimatedValue();
            setShape(fromWing + (toWing - fromWing) * f, fromExtra + (toExtra - fromExtra) * f);
        });
        animator.start();
    }

    private void update() {
        try {
            if (pill != null && pill.isAttachedToWindow()) wm.updateViewLayout(pill, lp);
        } catch (RuntimeException ignored) {
            // window went away during rotation
        }
    }

    private void applyVisibility() {
        if (pill == null) return;
        boolean hide = statusBarHidden && Prefs.hideFullscreen(this) && !flashing;
        pill.setVisibility(hide ? View.GONE : View.VISIBLE);
        int flags = lp.flags;
        if (hide) lp.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        else lp.flags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        if (flags != lp.flags) update();
    }

    /** Picks what the pill shows, grows or shrinks it to fit; returns when to look again. */
    private long updateContent() {
        if (pill == null) return 60_000;
        JSONObject s = Prefs.summary(this);
        JSONObject focus = s.optJSONObject("focus");
        long now = System.currentTimeMillis();
        boolean vertical = geometry != null && geometry.vertical();
        int kind = PillView.IDLE;
        String text = "";
        float progress = 0;
        long next = 60_000;
        if (RecorderService.recording()) {
            long ms = RecorderService.elapsed();
            boolean held = RecorderService.paused;
            kind = held ? PillView.REC_PAUSED : PillView.REC;
            text = vertical ? (held ? "II" : "●") : RecorderService.clock(ms);
            next = held ? 60_000 : 1000 - ms % 1000 + 5;
        } else if (focus != null) {
            long endsAt = focus.optLong("endsAt", 0);
            long total = Math.max(1, focus.optLong("totalMs", 0));
            if (endsAt > now) {
                long left = endsAt - now;
                long secs = (left + 999) / 1000;
                kind = PillView.TIMER;
                text = vertical ? String.valueOf((secs + 59) / 60) : String.format(Locale.ROOT, "%d:%02d", secs / 60, secs % 60);
                progress = focus.optLong("totalMs", 0) > 0 ? 1f - (float) left / total : 0;
                next = 1000 - left % 1000 + 5;
            } else if (endsAt == 0 && focus.optLong("leftMs", 0) > 0) {
                long left = focus.optLong("leftMs", 0);
                kind = PillView.PAUSED;
                text = vertical ? "II" : "พัก";
                progress = focus.optLong("totalMs", 0) > 0 ? 1f - (float) left / total : 0;
            }
        }
        if (kind == PillView.IDLE) {
            int open = Prefs.openToday(s);
            if (open > 0) {
                kind = PillView.COUNT;
                text = open > 99 ? "99+" : String.valueOf(open);
            }
        }
        pill.setContent(kind, text, progress);
        float wantWing = kind == PillView.TIMER || kind == PillView.REC || kind == PillView.REC_PAUSED ? WING_TIMER : kind == PillView.PAUSED ? WING_PAUSED : kind == PillView.COUNT ? WING_COUNT : WING_IDLE;
        if (vertical) wantWing = Math.min(wantWing, WING_COUNT);
        if (wantWing != targetWing) {
            targetWing = wantWing;
            if (!flashing && geometry != null) animateShape(targetWing, 0, 420);
        }
        return next;
    }

    /** Grows the pill downward to show a reminder for a few seconds (top edge only). */
    void flash(String text) {
        if (pill == null || geometry == null || geometry.vertical()) return;
        float density = getResources().getDisplayMetrics().density;
        Rect bounds = wm.getMaximumWindowMetrics().getBounds();
        TextPaint p = new TextPaint();
        p.setTextSize(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 14, getResources().getDisplayMetrics()));
        float hole = geometry.holeEnd - geometry.holeStart;
        float needLen = Math.min(bounds.width() * 0.62f, p.measureText(text) + 64 * density);
        float needWing = Math.max(targetWing, ((needLen - hole) / 2f) / density - PillGeometry.EAR_DP);
        flashing = true;
        applyVisibility();
        pill.setMessage(text);
        animateShape(needWing, 38 * density, 460);
        handler.removeCallbacks(endFlash);
        handler.postDelayed(endFlash, 7000);
    }

    private void collapse() {
        handler.removeCallbacks(endFlash);
        if (!flashing || pill == null) return;
        flashing = false;
        animateShape(targetWing, 0, 360);
        handler.postDelayed(() -> {
            if (!flashing && pill != null) pill.setMessage(null);
            applyVisibility();
        }, 380);
    }
}
