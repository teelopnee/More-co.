package com.moreco.paewai;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.text.TextPaint;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.GestureDetector;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.animation.OvershootInterpolator;

/**
 * The pill around the camera. Pure black so it melts into the notch (AMOLED pixels off), with
 * concave ears where it meets the screen edge, like the notch itself. Its wings carry one small
 * thing at a time: a yellow dot (idle), a blue count badge, or an orange focus ring and time.
 */
final class PillView extends View {
    interface Listener {
        void onOpen();

        void onLongPress();
    }

    static final int IDLE = 0;
    static final int COUNT = 1;
    static final int TIMER = 2;
    static final int PAUSED = 3;

    private static final int NOTE = 0xFFFFD43B;
    private static final int NOTE_FOLD = 0xFFE0A800;
    private static final int BLUE = 0xFF3E91FF;
    private static final int ORANGE = 0xFFFF9F0A;
    private static final int GREY = 0xFF8E8E93;
    private static final int TRACK = 0xFF2C2C2E;

    private final float dp;
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint label = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint message = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final Path shape = new Path();
    private final Path fold = new Path();
    private final Matrix toView = new Matrix();
    private final RectF rect = new RectF();
    private final float[] pt = new float[2];
    private final GestureDetector gestures;

    private PillGeometry geometry;
    private int extra;
    private int kind = IDLE;
    private String text = "";
    private float progress;
    private String messageText;
    private Listener listener;

    PillView(Context context) {
        super(context);
        // Samsung's dark mode would otherwise "invert" this overlay and paint the black pill white.
        setForceDarkAllowed(false);
        dp = getResources().getDisplayMetrics().density;
        fill.setColor(Color.BLACK);
        ring.setStyle(Paint.Style.STROKE);
        ring.setStrokeCap(Paint.Cap.ROUND);
        ring.setStrokeWidth(2.4f * dp);
        label.setTextAlign(Paint.Align.CENTER);
        label.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        label.setFontFeatureSettings("tnum");
        message.setColor(Color.WHITE);
        message.setTextAlign(Paint.Align.CENTER);
        message.setTextSize(sp(14));
        setContentDescription(context.getString(R.string.pill_description));
        gestures = new GestureDetector(context, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onDown(MotionEvent e) {
                return true;
            }

            @Override
            public boolean onSingleTapUp(MotionEvent e) {
                performClick();
                return true;
            }

            @Override
            public boolean onFling(MotionEvent e1, MotionEvent e2, float vx, float vy) {
                boolean towardScreen = geometry == null || !geometry.vertical()
                        ? vy > 0
                        : (geometry.edge == PillGeometry.LEFT ? vx > 0 : vx < 0);
                if (towardScreen) open();
                return true;
            }

            @Override
            public void onLongPress(MotionEvent e) {
                performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
                if (listener != null) listener.onLongPress();
            }
        });
    }

    private float sp(float v) {
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, getResources().getDisplayMetrics());
    }

    @Override
    public boolean performClick() {
        super.performClick();
        open();
        return true;
    }

    private void open() {
        performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
        if (listener != null) listener.onOpen();
    }

    void setListener(Listener l) {
        listener = l;
    }

    /** extra = how much taller than the resting pill the window is (for a reminder message). */
    void setShape(PillGeometry g, int extra) {
        geometry = g;
        this.extra = extra;
        invalidate();
    }

    void setContent(int kind, String text, float progress) {
        if (this.kind == kind && TextUtils.equals(this.text, text) && Math.abs(this.progress - progress) < 0.002f) return;
        this.kind = kind;
        this.text = text == null ? "" : text;
        this.progress = progress;
        invalidate();
    }

    void setMessage(String text) {
        messageText = text;
        invalidate();
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        int action = event.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN) {
            setPivotX(geometry != null && geometry.edge == PillGeometry.RIGHT ? getWidth() : geometry != null && geometry.edge == PillGeometry.LEFT ? 0 : getWidth() / 2f);
            setPivotY(geometry != null && geometry.vertical() ? getHeight() / 2f : 0);
            animate().scaleX(0.94f).scaleY(0.92f).setDuration(100).setInterpolator(null).start();
        } else if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
            animate().scaleX(1f).scaleY(1f).setDuration(340).setInterpolator(new OvershootInterpolator(2f)).start();
        }
        return gestures.onTouchEvent(event) || super.onTouchEvent(event);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        PillGeometry g = geometry;
        if (g == null) return;
        float len = g.length();
        float base = g.thickness();
        float thick = base + (g.vertical() ? 0 : extra);
        float ear = Math.min(g.ear, thick / 2f);
        float r = Math.min(Math.min(thick - ear, thick / 2f), (extra > 0 ? 22 : 16) * dp);

        // The shape in "hanging from the top" coordinates (u along the edge, v away from it)…
        shape.reset();
        shape.moveTo(0, 0);
        shape.quadTo(ear, 0, ear, ear);
        shape.lineTo(ear, thick - r);
        rect.set(ear, thick - 2 * r, ear + 2 * r, thick);
        shape.arcTo(rect, 180, -90);
        shape.lineTo(len - ear - r, thick);
        rect.set(len - ear - 2 * r, thick - 2 * r, len - ear, thick);
        shape.arcTo(rect, 90, -90);
        shape.lineTo(len - ear, ear);
        shape.quadTo(len - ear, 0, len, 0);
        shape.close();
        // …then turned to whichever edge the camera is on.
        toView.reset();
        if (g.edge == PillGeometry.LEFT) toView.setValues(new float[] {0, 1, 0, 1, 0, 0, 0, 0, 1});
        else if (g.edge == PillGeometry.RIGHT) toView.setValues(new float[] {0, -1, getWidth(), 1, 0, 0, 0, 0, 1});
        shape.transform(toView);
        canvas.drawPath(shape, fill);

        float mid = base / 2f;
        float left = (ear + g.holeStart) / 2f;
        float right = (g.holeEnd + len - ear) / 2f;
        if (g.edge == PillGeometry.FALLBACK) {
            left = g.holeStart;
            right = g.holeEnd;
        }
        drawLeft(canvas, at(left, mid));
        drawRight(canvas, at(right, mid), g.vertical());

        if (messageText != null && extra > 0 && !g.vertical()) {
            CharSequence fit = TextUtils.ellipsize(messageText, message, len - 2 * ear - 28 * dp, TextUtils.TruncateAt.END);
            Paint.FontMetrics fm = message.getFontMetrics();
            float cy = base + extra / 2f - 2 * dp;
            canvas.drawText(fit, 0, fit.length(), len / 2f, cy - (fm.ascent + fm.descent) / 2f, message);
        }
    }

    /** Maps (along, across) to view coordinates; returns pt. */
    private float[] at(float u, float v) {
        pt[0] = u;
        pt[1] = v;
        toView.mapPoints(pt);
        return pt;
    }

    private void drawLeft(Canvas canvas, float[] c) {
        float x = c[0], y = c[1];
        if (kind == TIMER || kind == PAUSED) {
            float rad = 7.5f * dp;
            rect.set(x - rad, y - rad, x + rad, y + rad);
            ring.setColor(TRACK);
            canvas.drawArc(rect, 0, 360, false, ring);
            ring.setColor(kind == TIMER ? ORANGE : GREY);
            canvas.drawArc(rect, -90, Math.max(4, 360 * progress), false, ring);
        } else if (kind == COUNT) {
            // a tiny sticky note
            float s = 5.5f * dp;
            paint.setColor(NOTE);
            rect.set(x - s, y - s, x + s, y + s);
            canvas.drawRoundRect(rect, 2 * dp, 2 * dp, paint);
            fold.reset();
            fold.moveTo(x + s, y + s * 0.2f);
            fold.lineTo(x + s * 0.2f, y + s);
            fold.lineTo(x + s, y + s);
            fold.close();
            paint.setColor(NOTE_FOLD);
            canvas.drawPath(fold, paint);
        } else {
            paint.setColor(NOTE);
            canvas.drawCircle(x, y, 3f * dp, paint);
        }
    }

    private void drawRight(Canvas canvas, float[] c, boolean vertical) {
        float x = c[0], y = c[1];
        if (text.isEmpty() || kind == IDLE) return;
        if (kind == COUNT) {
            // Samsung-style blue badge
            label.setTextSize(sp(11.5f));
            label.setColor(Color.WHITE);
            float h = 18 * dp;
            float w = Math.max(h, label.measureText(text) + 10 * dp);
            rect.set(x - w / 2, y - h / 2, x + w / 2, y + h / 2);
            paint.setColor(BLUE);
            canvas.drawRoundRect(rect, h / 2, h / 2, paint);
        } else {
            label.setTextSize(sp(vertical ? 11 : 13.5f));
            label.setColor(kind == TIMER ? ORANGE : GREY);
        }
        Paint.FontMetrics fm = label.getFontMetrics();
        canvas.drawText(text, x, y - (fm.ascent + fm.descent) / 2f, label);
    }
}
