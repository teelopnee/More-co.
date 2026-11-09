package com.moreco.paewai;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Where in the recording each run of words was said: pairs of [character offset in the text, ms in
 * the audio], so the page can play from a spot in the transcript. Kept as "[[0,0],[42,5300]]" in the
 * recording's .json file. Pure Java, so it can be unit tested.
 */
final class Times {
    private Times() {}

    private static final Pattern PAIR = Pattern.compile("\\[\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\]");

    static String format(List<long[]> times) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < times.size(); i++) {
            long[] t = times.get(i);
            if (i > 0) b.append(',');
            b.append(String.format(Locale.ROOT, "[%d,%d]", t[0], t[1]));
        }
        return b.append(']').toString();
    }

    static List<long[]> parse(String s) {
        List<long[]> out = new ArrayList<>();
        if (s == null) return out;
        Matcher m = PAIR.matcher(s);
        while (m.find()) out.add(new long[] {Long.parseLong(m.group(1)), Long.parseLong(m.group(2))});
        return out;
    }

    /**
     * Text added after `before` (joined with a space): its times move along. Used when the part that
     * live transcription missed is transcribed afterwards and appended.
     */
    static List<long[]> append(List<long[]> before, int beforeLength, List<long[]> added) {
        List<long[]> out = new ArrayList<>(before);
        long shift = beforeLength == 0 ? 0 : beforeLength + 1;
        long last = out.isEmpty() ? 0 : out.get(out.size() - 1)[1];
        for (long[] t : added) {
            long ms = Math.max(last, t[1]);
            out.add(new long[] {t[0] + shift, ms});
            last = ms;
        }
        return out;
    }
}
