package com.moreco.paewai;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.text.TextPaint;
import android.text.TextUtils;
import android.view.GestureDetector;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;

/** The black pill around the camera: a note icon on one side, a count or timer on the other. */
final class PillView extends View {
    interface Listener {
        void onOpen();

        void onLongPress();
    }

    private final float dp;
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint note = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint fold = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint label = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint message = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private final Path corner = new Path();
    private final float[] radii = new float[8];
    private final RectF rect = new RectF();
    private final GestureDetector gestures;

    private PillGeometry base;
    private int offsetX;
    private int offsetY;
    private String labelText = "";
    private String messageText = null;
    private Listener listener;

    PillView(Context context) {
        super(context);
        dp = getResources().getDisplayMetrics().density;
        fill.setColor(Color.BLACK);
        note.setColor(0xFFFFD43B);
        fold.setColor(0xFFE0A800);
        label.setColor(Color.WHITE);
        label.setTextSize(13 * getResources().getDisplayMetrics().scaledDensity);
        label.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        label.setTextAlign(Paint.Align.CENTER);
        message.setColor(Color.WHITE);
        message.setTextSize(14 * getResources().getDisplayMetrics().scaledDensity);
        message.setTextAlign(Paint.Align.CENTER);
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
                boolean towardScreen = base == null || !base.vertical()
                        ? vy > 0
                        : (base.edge == PillGeometry.LEFT ? vx > 0 : vx < 0);
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

    /** base = resting pill; offsets = where this (possibly larger) window starts relative to it. */
    void setGeometry(PillGeometry base, int offsetX, int offsetY) {
        this.base = base;
        this.offsetX = offsetX;
        this.offsetY = offsetY;
        invalidate();
    }

    void setLabel(String text) {
        if (TextUtils.equals(text, labelText)) return;
        labelText = text == null ? "" : text;
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
            setPivotX(getWidth() / 2f);
            setPivotY(0);
            animate().scaleX(0.92f).scaleY(0.9f).setDuration(90).setInterpolator(null).start();
        } else if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
            animate().scaleX(1f).scaleY(1f).setDuration(320).setInterpolator(new android.view.animation.OvershootInterpolator(2.2f)).start();
        }
        return gestures.onTouchEvent(event) || super.onTouchEvent(event);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        if (base == null) return;
        int w = getWidth();
        int h = getHeight();
        float r;
        path.reset();
        rect.set(0, 0, w, h);
        // The side touching the screen edge stays square.
        if (base.edge == PillGeometry.LEFT) {
            r = Math.min(w, 18 * dp);
            setCorners(0, r, r, 0);
        } else if (base.edge == PillGeometry.RIGHT) {
            r = Math.min(w, 18 * dp);
            setCorners(r, 0, 0, r);
        } else {
            r = Math.min(h / 2f, 18 * dp);
            setCorners(0, 0, r, r);
        }
        path.addRoundRect(rect, radii, Path.Direction.CW);
        canvas.drawPath(path, fill);

        float icon = 12 * dp;
        if (base.vertical()) {
            float cx = w / 2f;
            float holeMid = offsetY + (base.holeStart + base.holeEnd) / 2f;
            float half = (base.holeEnd - base.holeStart) / 2f;
            float wing = (base.height - (base.holeEnd - base.holeStart)) / 2f;
            drawNote(canvas, cx, holeMid - half - wing / 2f, icon);
            drawLabel(canvas, cx, holeMid + half + wing / 2f);
        } else {
            float cy = Math.min(h, base.height) / 2f;
            float holeMid = (base.holeStart + base.holeEnd) / 2f - offsetX;
            float half = (base.holeEnd - base.holeStart) / 2f;
            float wing = (base.width - (base.holeEnd - base.holeStart)) / 2f;
            if (base.edge == PillGeometry.FALLBACK) {
                drawNote(canvas, holeMid - 30 * dp, cy, icon);
                drawLabel(canvas, holeMid + 14 * dp, cy);
            } else {
                drawNote(canvas, holeMid - half - wing / 2f, cy, icon);
                drawLabel(canvas, holeMid + half + wing / 2f, cy);
            }
            if (messageText != null && h > base.height) {
                float band = h - base.height;
                CharSequence fit = TextUtils.ellipsize(messageText, message, w - 32 * dp, TextUtils.TruncateAt.END);
                Paint.FontMetrics fm = message.getFontMetrics();
                float baseline = base.height + band / 2f - (fm.ascent + fm.descent) / 2f - 2 * dp;
                canvas.drawText(fit, 0, fit.length(), w / 2f, baseline, message);
            }
        }
    }

    private void setCorners(float tl, float tr, float br, float bl) {
        radii[0] = radii[1] = tl;
        radii[2] = radii[3] = tr;
        radii[4] = radii[5] = br;
        radii[6] = radii[7] = bl;
    }

    private void drawNote(Canvas canvas, float cx, float cy, float size) {
        float s = size / 2f;
        canvas.save();
        canvas.rotate(-7, cx, cy);
        rect.set(cx - s, cy - s, cx + s, cy + s);
        canvas.drawRoundRect(rect, 2 * dp, 2 * dp, note);
        corner.reset();
        corner.moveTo(cx + s, cy + s * 0.25f);
        corner.lineTo(cx + s * 0.25f, cy + s);
        corner.lineTo(cx + s, cy + s);
        corner.close();
        canvas.drawPath(corner, fold);
        canvas.restore();
    }

    private void drawLabel(Canvas canvas, float cx, float cy) {
        if (labelText.isEmpty()) return;
        Paint.FontMetrics fm = label.getFontMetrics();
        canvas.drawText(labelText, cx, cy - (fm.ascent + fm.descent) / 2f, label);
    }
}
