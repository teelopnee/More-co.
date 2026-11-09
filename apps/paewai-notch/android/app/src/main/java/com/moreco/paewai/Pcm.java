package com.moreco.paewai;

/** Small pure helpers for 16-bit little-endian PCM (kept apart so they can be unit tested). */
final class Pcm {
    private Pcm() {}

    static short sample(byte[] b, int i) {
        return (short) ((b[i] & 0xFF) | (b[i + 1] << 8));
    }

    /** Loudest sample, 0..1. */
    static float peak(byte[] b, int len) {
        int max = 0;
        for (int i = 0; i + 1 < len; i += 2) max = Math.max(max, Math.abs((int) sample(b, i)));
        return Math.min(1f, max / 32767f);
    }

    /**
     * Exactly zero everywhere: a real microphone always has some noise, so this means another app
     * took the microphone and Android is feeding us silence.
     */
    static boolean silent(byte[] b, int len) {
        for (int i = 0; i < len; i++) if (b[i] != 0) return false;
        return true;
    }

    /** ADTS header for one AAC-LC frame, so the .aac file plays (and survives a crash) without a container. */
    static byte[] adtsHeader(int frameLength, int sampleRate, int channels) {
        int len = frameLength + 7;
        int freq = frequencyIndex(sampleRate);
        int profile = 2; // AAC LC
        return new byte[] {
            (byte) 0xFF,
            (byte) 0xF1,
            (byte) (((profile - 1) << 6) | (freq << 2) | (channels >> 2)),
            (byte) (((channels & 3) << 6) | (len >> 11)),
            (byte) ((len & 0x7FF) >> 3),
            (byte) (((len & 7) << 5) | 0x1F),
            (byte) 0xFC,
        };
    }

    static int frequencyIndex(int rate) {
        int[] rates = {96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350};
        for (int i = 0; i < rates.length; i++) if (rates[i] == rate) return i;
        throw new IllegalArgumentException("sample rate " + rate);
    }

    /** Turns any decoded PCM (rate, channels) into 16 kHz mono for the speech recognizer. */
    static final class To16k {
        interface Sink {
            void accept(byte[] chunk) throws Exception;
        }

        private final double step;
        private final int channels;
        private final Sink sink;
        private double pos; // position of the next output sample, in input samples from `prev`
        private float prev;
        private boolean havePrev;
        private final byte[] out = new byte[3200]; // 100 ms
        private int outLen;

        To16k(int inRate, int channels, Sink sink) {
            this.step = inRate / 16000.0;
            this.channels = Math.max(1, channels);
            this.sink = sink;
        }

        /** Interleaved 16-bit samples. */
        void push(byte[] pcm, int len) throws Exception {
            int frame = channels * 2;
            for (int i = 0; i + frame <= len; i += frame) {
                int sum = 0;
                for (int c = 0; c < channels; c++) sum += sample(pcm, i + c * 2);
                float cur = (float) sum / channels;
                if (!havePrev) {
                    prev = cur;
                    havePrev = true;
                    continue;
                }
                // Output samples that fall between prev (0) and cur (1).
                while (pos < 1) {
                    emit(prev + (cur - prev) * (float) pos);
                    pos += step;
                }
                pos -= 1;
                prev = cur;
            }
        }

        void flush() throws Exception {
            if (outLen > 0) {
                byte[] chunk = new byte[outLen];
                System.arraycopy(out, 0, chunk, 0, outLen);
                outLen = 0;
                sink.accept(chunk);
            }
        }

        private void emit(float v) throws Exception {
            int s = Math.max(-32768, Math.min(32767, Math.round(v)));
            out[outLen++] = (byte) s;
            out[outLen++] = (byte) (s >> 8);
            if (outLen == out.length) {
                sink.accept(out.clone());
                outLen = 0;
            }
        }
    }
}
