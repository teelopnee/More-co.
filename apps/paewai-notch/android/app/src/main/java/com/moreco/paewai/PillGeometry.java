package com.moreco.paewai;

/**
 * Where the pill goes: wrapped around the camera cut-out, flush with the screen edge.
 * Plain ints so it can be unit-tested without Android.
 */
public final class PillGeometry {
    public static final int TOP = 0;
    public static final int LEFT = 1;
    public static final int RIGHT = 2;
    /** No cut-out (or one we do not understand): a small pill at the top centre. */
    public static final int FALLBACK = 3;

    public final int edge;
    public final int x;
    public final int y;
    public final int width;
    public final int height;
    /** The camera, along the pill's long side, relative to the pill. */
    public final int holeStart;
    public final int holeEnd;

    PillGeometry(int edge, int x, int y, int width, int height, int holeStart, int holeEnd) {
        this.edge = edge;
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.holeStart = holeStart;
        this.holeEnd = holeEnd;
    }

    public boolean vertical() {
        return edge == LEFT || edge == RIGHT;
    }

    /**
     * @param cutout {left, top, right, bottom} of the camera cut-out in screen pixels, or null
     * @param density pixels per dp
     */
    public static PillGeometry compute(int screenW, int screenH, int[] cutout, float density) {
        int wing = Math.round(54 * density);
        int minThick = Math.round(26 * density);
        if (cutout != null && cutout.length == 4 && cutout[2] > cutout[0] && cutout[3] > cutout[1]) {
            int l = cutout[0], t = cutout[1], r = cutout[2], b = cutout[3];
            if (t <= 0 && b < screenH / 2) {
                int h = Math.max(b, minThick);
                int w = Math.min(screenW, (r - l) + 2 * wing);
                int x = clamp((l + r) / 2 - w / 2, 0, screenW - w);
                return new PillGeometry(TOP, x, 0, w, h, l - x, r - x);
            }
            if (l <= 0 && r < screenW / 2) {
                int w = Math.max(r, minThick);
                int h = Math.min(screenH, (b - t) + 2 * wing);
                int y = clamp((t + b) / 2 - h / 2, 0, screenH - h);
                return new PillGeometry(LEFT, 0, y, w, h, t - y, b - y);
            }
            if (r >= screenW && l > screenW / 2) {
                int w = Math.max(screenW - l, minThick);
                int h = Math.min(screenH, (b - t) + 2 * wing);
                int y = clamp((t + b) / 2 - h / 2, 0, screenH - h);
                return new PillGeometry(RIGHT, screenW - w, y, w, h, t - y, b - y);
            }
        }
        int w = Math.min(screenW, Math.round(132 * density));
        return new PillGeometry(FALLBACK, (screenW - w) / 2, 0, w, minThick, w / 2, w / 2);
    }

    static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }
}
