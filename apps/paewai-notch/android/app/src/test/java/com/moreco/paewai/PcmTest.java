package com.moreco.paewai;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;

import org.junit.Test;

public class PcmTest {
    private static byte[] pcm(short... s) {
        byte[] b = new byte[s.length * 2];
        for (int i = 0; i < s.length; i++) {
            b[2 * i] = (byte) s[i];
            b[2 * i + 1] = (byte) (s[i] >> 8);
        }
        return b;
    }

    @Test
    public void adtsHeaderFor16kMono() {
        // AAC LC, 16 kHz (index 8), 1 channel, 100-byte frame → 107 bytes with the header
        byte[] h = Pcm.adtsHeader(100, 16000, 1);
        assertEquals(7, h.length);
        assertEquals((byte) 0xFF, h[0]);
        assertEquals((byte) 0xF1, h[1]);
        assertEquals(1, (h[2] & 0xC0) >> 6); // profile - 1
        assertEquals(8, (h[2] & 0x3C) >> 2); // sampling frequency index
        int channels = ((h[2] & 1) << 2) | ((h[3] & 0xC0) >> 6);
        assertEquals(1, channels);
        int len = ((h[3] & 3) << 11) | ((h[4] & 0xFF) << 3) | ((h[5] & 0xE0) >> 5);
        assertEquals(107, len);
        assertEquals(4, Pcm.frequencyIndex(44100));
    }

    @Test
    public void levelsAndTrueSilence() {
        byte[] quiet = pcm((short) 0, (short) 3, (short) -2);
        assertFalse(Pcm.silent(quiet, quiet.length));
        assertTrue(Pcm.silent(new byte[64], 64));
        assertEquals(1f, Pcm.peak(pcm((short) -32768), 2), 0.001f);
        assertEquals(0.5f, Pcm.peak(pcm((short) 100, (short) -16384), 4), 0.001f);
    }

    @Test
    public void resamples48kStereoTo16kMono() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Pcm.To16k r = new Pcm.To16k(48000, 2, out::write);
        // one second of stereo: left 1000, right 3000 → mono 2000
        short[] s = new short[48000 * 2];
        for (int i = 0; i < 48000; i++) {
            s[2 * i] = 1000;
            s[2 * i + 1] = 3000;
        }
        byte[] in = pcm(s);
        r.push(in, in.length / 2); // in two pieces, like a decoder hands them out
        r.push(java.util.Arrays.copyOfRange(in, in.length / 2, in.length), in.length / 2);
        r.flush();
        byte[] mono = out.toByteArray();
        int samples = mono.length / 2;
        assertTrue("about 16000 samples, got " + samples, Math.abs(samples - 16000) <= 2);
        for (int i = 0; i + 1 < mono.length; i += 2) assertEquals(2000, Pcm.sample(mono, i));
    }

    @Test
    public void passes16kMonoThrough() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Pcm.To16k r = new Pcm.To16k(16000, 1, out::write);
        byte[] in = pcm((short) 1, (short) 2, (short) 3, (short) 4);
        r.push(in, in.length);
        r.flush();
        assertArrayEquals(pcm((short) 1, (short) 2, (short) 3), out.toByteArray()); // the last sample waits for its neighbour
    }
}
