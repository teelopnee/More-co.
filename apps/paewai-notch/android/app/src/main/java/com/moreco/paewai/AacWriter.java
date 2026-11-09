package com.moreco.paewai;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.os.SystemClock;

import java.io.BufferedOutputStream;
import java.io.Closeable;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;

/**
 * 16-bit mono PCM → AAC-LC frames with ADTS headers (.aac). Every frame stands on its own, so a
 * recording cut off by a crash still plays up to the last few seconds; written to disk every ~4 s.
 */
final class AacWriter implements Closeable {
    private final MediaCodec codec;
    private final FileOutputStream file;
    private final BufferedOutputStream out;
    private final int rate;
    private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
    private long samples;
    private long lastSync = SystemClock.uptimeMillis();
    private boolean closed;

    AacWriter(File f, int rate, int bitRate) throws IOException {
        this.rate = rate;
        MediaFormat fmt = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, rate, 1);
        fmt.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
        fmt.setInteger(MediaFormat.KEY_BIT_RATE, bitRate);
        fmt.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16_384);
        codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
        try {
            codec.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            codec.start();
        } catch (RuntimeException e) {
            codec.release();
            throw new IOException("AAC encoder", e);
        }
        file = new FileOutputStream(f, true);
        out = new BufferedOutputStream(file, 16_384);
    }

    void write(byte[] pcm, int len) throws IOException {
        int off = 0;
        while (off < len) {
            int idx = codec.dequeueInputBuffer(20_000);
            if (idx >= 0) {
                ByteBuffer b = codec.getInputBuffer(idx);
                if (b == null) continue;
                b.clear();
                int n = Math.min(b.remaining(), len - off) & ~1;
                b.put(pcm, off, n);
                codec.queueInputBuffer(idx, 0, n, samples * 1_000_000L / rate, 0);
                samples += n / 2;
                off += n;
            }
            drain(false);
        }
        if (SystemClock.uptimeMillis() - lastSync > 4000) {
            out.flush();
            lastSync = SystemClock.uptimeMillis();
        }
    }

    private void drain(boolean untilEnd) throws IOException {
        long deadline = SystemClock.uptimeMillis() + 3000;
        while (true) {
            int idx = codec.dequeueOutputBuffer(info, untilEnd ? 10_000 : 0);
            if (idx == MediaCodec.INFO_TRY_AGAIN_LATER) {
                if (!untilEnd || SystemClock.uptimeMillis() > deadline) return;
                continue;
            }
            if (idx < 0) continue; // output format changed: nothing to write
            ByteBuffer b = codec.getOutputBuffer(idx);
            if (b != null && info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                byte[] frame = new byte[info.size];
                b.position(info.offset);
                b.get(frame, 0, info.size);
                out.write(Pcm.adtsHeader(info.size, rate, 1));
                out.write(frame);
            }
            codec.releaseOutputBuffer(idx, false);
            if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) return;
        }
    }

    @Override
    public void close() throws IOException {
        if (closed) return;
        closed = true;
        try {
            int idx = codec.dequeueInputBuffer(50_000);
            if (idx >= 0) codec.queueInputBuffer(idx, 0, 0, samples * 1_000_000L / rate, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
            drain(true);
        } catch (RuntimeException ignored) {
            // the encoder broke: keep what was written
        } finally {
            try {
                codec.stop();
            } catch (RuntimeException ignored) {
                // already stopped
            }
            codec.release();
            out.flush();
            file.getFD().sync();
            out.close();
        }
    }
}
