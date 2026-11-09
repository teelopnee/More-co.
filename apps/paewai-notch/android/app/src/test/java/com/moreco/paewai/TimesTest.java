package com.moreco.paewai;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.Arrays;
import java.util.List;

import org.junit.Test;

public class TimesTest {
    @Test
    public void formatAndParse() {
        List<long[]> t = Arrays.asList(new long[] {0, 0}, new long[] {42, 5300});
        String s = Times.format(t);
        assertEquals("[[0,0],[42,5300]]", s);
        List<long[]> back = Times.parse(s);
        assertEquals(2, back.size());
        assertArrayEquals(new long[] {42, 5300}, back.get(1));
        assertEquals(0, Times.parse(null).size());
        assertEquals(0, Times.parse("nonsense").size());
    }

    @Test
    public void appendedTextKeepsItsPlace() {
        List<long[]> before = Arrays.asList(new long[] {0, 0}, new long[] {10, 4000});
        List<long[]> added = Arrays.asList(new long[] {0, 600_000}, new long[] {8, 3000}); // out of order
        List<long[]> all = Times.append(before, 20, added);
        assertEquals(4, all.size());
        assertArrayEquals(new long[] {21, 600_000}, all.get(2)); // after "…20 chars" + a space
        assertArrayEquals(new long[] {29, 600_000}, all.get(3)); // never goes back in time
        assertArrayEquals(new long[] {0, 1000}, Times.append(Arrays.asList(), 0, Arrays.asList(new long[] {0, 1000})).get(0));
    }

    @Test
    public void skipsTheStartOfAStream() {
        long[] rest = {3};
        assertNull(Pcm.skip(new byte[4], rest)); // 2 samples: all skipped
        assertEquals(1, rest[0]);
        byte[] out = Pcm.skip(new byte[] {1, 2, 3, 4, 5, 6}, rest); // skip 1 more sample of 3
        assertArrayEquals(new byte[] {3, 4, 5, 6}, out);
        assertEquals(0, rest[0]);
        byte[] same = {9, 9};
        assertEquals(same, Pcm.skip(same, rest));
    }
}
