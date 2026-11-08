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
import android.view.Display;
import android.view.DisplayCutout;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.animation.DecelerateInterpolator;

import org.json.JSONObject;

import java.util.List;

/**
 * Draws the pill over the camera cut-out, above the status bar, in every app.
 * It is an accessibility service only because that is the one kind of window Android lets an
 * app place over the status bar. It reads nothing on screen (canRetrieveWindowContent=false).
 */
public class NotchService extends AccessibilityService {
    static NotchService instance;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WindowManager wm;
    private PillView pill;
    private WindowManager.LayoutParams lp;
    private PillGeometry geometry;
    private boolean sawStatusBar;
    private boolean statusBarHidden;
    private boolean flashing;
    private ValueAnimator animator;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            long next = updateLabel();
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

    /** Called after the web app saves: redraw the label, show or hide the pill. */
    static void refreshIfRunning() {
        NotchService s = instance;
        if (s != null) s.refresh();
    }

    static void flashIfRunning(String text) {
        NotchService s = instance;
        if (s != null) s.flash(text);
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
        handler.postDelayed(this::layout, 300);
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
                Intent i = new Intent(NotchService.this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
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
        computeGeometry();
        applyGeometry(geometry.x, geometry.y, geometry.width, geometry.height);
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

    private void computeGeometry() {
        Rect bounds = wm.getMaximumWindowMetrics().getBounds();
        float density = getResources().getDisplayMetrics().density;
        geometry = PillGeometry.compute(bounds.width(), bounds.height(), cutoutRect(), density);
    }

    private int[] cutoutRect() {
        DisplayCutout cutout = null;
        try {
            Display d = getSystemService(DisplayManager.class).getDisplay(Display.DEFAULT_DISPLAY);
            if (d != null) cutout = d.getCutout();
        } catch (RuntimeException ignored) {
            // fall through
        }
        if (cutout == null) {
            WindowInsets insets = wm.getMaximumWindowMetrics().getWindowInsets();
            cutout = insets.getDisplayCutout();
        }
        if (cutout == null) return null;
        List<Rect> rects = cutout.getBoundingRects();
        for (Rect r : rects) {
            if (!r.isEmpty()) return new int[] {r.left, r.top, r.right, r.bottom};
        }
        return null;
    }

    private void layout() {
        if (pill == null) return;
        if (animator != null) animator.cancel();
        flashing = false;
        pill.setMessage(null);
        computeGeometry();
        applyGeometry(geometry.x, geometry.y, geometry.width, geometry.height);
        update();
    }

    private void applyGeometry(int x, int y, int w, int h) {
        lp.x = x;
        lp.y = y;
        lp.width = w;
        lp.height = h;
        pill.setGeometry(geometry, x - geometry.x, y - geometry.y);
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

    /** Updates the label; returns when to look again. */
    private long updateLabel() {
        if (pill == null) return 60_000;
        JSONObject s = Prefs.summary(this);
        JSONObject focus = s.optJSONObject("focus");
        long now = System.currentTimeMillis();
        if (focus != null) {
            long endsAt = focus.optLong("endsAt", 0);
            if (endsAt > now) {
                long secs = (endsAt - now + 999) / 1000;
                pill.setLabel(String.format(java.util.Locale.ROOT, "%d:%02d", secs / 60, secs % 60));
                return 1000 - (endsAt - now) % 1000 + 5;
            }
            if (focus.optLong("leftMs", 0) > 0 && endsAt == 0) {
                pill.setLabel("พัก");
                return 60_000;
            }
        }
        int open = Prefs.openToday(s);
        pill.setLabel(open > 0 ? String.valueOf(open) : "");
        return 60_000;
    }

    /** Grows the pill to show a reminder for a few seconds (top edge only). */
    void flash(String text) {
        if (pill == null || geometry == null || geometry.vertical()) return;
        Rect bounds = wm.getMaximumWindowMetrics().getBounds();
        float dp = getResources().getDisplayMetrics().density;
        int targetW = Math.min(Math.round(bounds.width() * 0.6f), Math.max(geometry.width, Math.round(pillTextWidth(text) + 48 * dp)));
        int targetH = geometry.height + Math.round(34 * dp);
        int centre = geometry.x + (geometry.holeStart + geometry.holeEnd) / 2;
        int targetX = PillGeometry.clamp(centre - targetW / 2, 0, bounds.width() - targetW);
        flashing = true;
        applyVisibility();
        pill.setMessage(text);
        animate(targetX, targetW, targetH);
        handler.removeCallbacks(endFlash);
        handler.postDelayed(endFlash, 7000);
    }

    private float pillTextWidth(String text) {
        android.text.TextPaint p = new android.text.TextPaint();
        p.setTextSize(14 * getResources().getDisplayMetrics().scaledDensity);
        return p.measureText(text);
    }

    private void collapse() {
        handler.removeCallbacks(endFlash);
        if (!flashing || pill == null) return;
        flashing = false;
        animate(geometry.x, geometry.width, geometry.height);
        handler.postDelayed(() -> {
            if (!flashing && pill != null) pill.setMessage(null);
            applyVisibility();
        }, 260);
    }

    private void animate(int toX, int toW, int toH) {
        if (animator != null) animator.cancel();
        int fromX = lp.x, fromW = lp.width, fromH = lp.height;
        animator = ValueAnimator.ofFloat(0f, 1f);
        animator.setDuration(240);
        animator.setInterpolator(new DecelerateInterpolator());
        animator.addUpdateListener(a -> {
            float f = (float) a.getAnimatedValue();
            applyGeometry(Math.round(fromX + (toX - fromX) * f), geometry.y, Math.round(fromW + (toW - fromW) * f), Math.round(fromH + (toH - fromH) * f));
            update();
        });
        animator.start();
    }
}
