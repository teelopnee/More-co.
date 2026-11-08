package com.moreco.paewai;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.LocalDate;

/** Small settings and the summary the web app sends for the pill. */
final class Prefs {
    private Prefs() {}

    static SharedPreferences get(Context c) {
        return c.getSharedPreferences("paewai", Context.MODE_PRIVATE);
    }

    static boolean pillEnabled(Context c) {
        return get(c).getBoolean("pill", true);
    }

    static boolean hideFullscreen(Context c) {
        return get(c).getBoolean("hideFullscreen", true);
    }

    static void saveSummary(Context c, String json) {
        get(c).edit().putString("summary", json).apply();
    }

    static JSONObject summary(Context c) {
        try {
            return new JSONObject(get(c).getString("summary", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    /** Unfinished tasks due today or earlier. */
    static int openToday(JSONObject summary) {
        JSONArray days = summary.optJSONArray("openDays");
        if (days == null) return 0;
        String today = LocalDate.now().toString();
        int n = 0;
        for (int i = 0; i < days.length(); i++) {
            if (days.optString(i).compareTo(today) <= 0) n++;
        }
        return n;
    }
}
