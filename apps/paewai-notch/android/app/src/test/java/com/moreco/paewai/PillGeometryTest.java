package com.moreco.paewai;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PillGeometryTest {
    private static final float D = 2f; // 2 px per dp
    private static final int EAR = PillGeometry.EAR_DP * 2;

    @Test
    public void wrapsATopNotchAndCentresOnIt() {
        // 2960 x 1848 landscape, a 120 x 64 px notch at the top centre, 40dp wings
        PillGeometry g = PillGeometry.compute(2960, 1848, new int[] {1420, 0, 1540, 64}, D, 40);
        assertEquals(PillGeometry.TOP, g.edge);
        assertEquals(0, g.y);
        assertEquals(64, g.height);
        assertEquals(120 + 2 * (80 + EAR), g.width);
        assertEquals(1480, g.x + g.width / 2);
        assertEquals(1420, g.x + g.holeStart);
        assertEquals(1540, g.x + g.holeEnd);
        assertEquals(EAR, g.ear);
    }

    @Test
    public void wingsGrowAroundTheSameCentre() {
        int[] notch = {1420, 0, 1540, 64};
        PillGeometry small = PillGeometry.compute(2960, 1848, notch, D, 16);
        PillGeometry wide = PillGeometry.compute(2960, 1848, notch, D, 60);
        assertTrue(wide.width > small.width);
        assertEquals(small.x + small.width / 2, wide.x + wide.width / 2);
        assertEquals(small.x + small.holeStart, wide.x + wide.holeStart);
    }

    @Test
    public void keepsAMinimumThickness() {
        PillGeometry g = PillGeometry.compute(2960, 1848, new int[] {1460, 0, 1500, 20}, D, 40);
        assertEquals(PillGeometry.MIN_THICK_DP * 2, g.height);
    }

    @Test
    public void sideNotchInPortrait() {
        // portrait: the camera is on the right edge
        PillGeometry g = PillGeometry.compute(1848, 2960, new int[] {1784, 1420, 1848, 1540}, D, 40);
        assertEquals(PillGeometry.RIGHT, g.edge);
        assertEquals(64, g.width);
        assertEquals(1848 - 64, g.x);
        assertEquals(1480, g.y + g.height / 2);
        assertEquals(g.height, g.length());
        assertEquals(g.width, g.thickness());
        PillGeometry left = PillGeometry.compute(1848, 2960, new int[] {0, 1420, 64, 1540}, D, 40);
        assertEquals(PillGeometry.LEFT, left.edge);
        assertEquals(0, left.x);
    }

    @Test
    public void noNotchFallsBackToTopCentre() {
        PillGeometry g = PillGeometry.compute(2000, 1200, null, D, 40);
        assertEquals(PillGeometry.FALLBACK, g.edge);
        assertEquals(1000, g.x + g.width / 2);
        assertEquals(1000, g.x + (g.holeStart + g.holeEnd) / 2);
        PillGeometry empty = PillGeometry.compute(2000, 1200, new int[] {0, 0, 0, 0}, D, 40);
        assertEquals(PillGeometry.FALLBACK, empty.edge);
    }

    @Test
    public void notchNearTheCornerStaysOnScreen() {
        PillGeometry g = PillGeometry.compute(2960, 1848, new int[] {10, 0, 90, 60}, D, 40);
        assertTrue(g.x >= 0);
        assertTrue(g.x + g.width <= 2960);
        assertEquals(10, g.x + g.holeStart);
    }
}
