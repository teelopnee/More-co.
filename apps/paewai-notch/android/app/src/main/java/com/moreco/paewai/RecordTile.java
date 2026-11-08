package com.moreco.paewai;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** Quick Settings tile "อัดเสียง": swipe down, tap, recording starts (tap again to stop). */
public class RecordTile extends TileService {
    static void refresh(Context c) {
        try {
            TileService.requestListeningState(c, new ComponentName(c, RecordTile.class));
        } catch (RuntimeException ignored) {
            // the tile is not added
        }
    }

    @Override
    public void onStartListening() {
        super.onStartListening();
        update();
    }

    @Override
    @SuppressWarnings("deprecation")
    @SuppressLint("StartActivityAndCollapseDeprecated") // the Intent form is the only one before Android 14
    public void onClick() {
        super.onClick();
        if (RecorderService.recording()) {
            startService(RecorderService.intent(this, RecorderService.STOP));
            update();
            return;
        }
        // Starting the microphone needs a visible activity: RecordActivity starts it and closes at once.
        Intent i = new Intent(this, RecordActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 31, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        } else {
            startActivityAndCollapse(i);
        }
    }

    private void update() {
        Tile t = getQsTile();
        if (t == null) return;
        boolean on = RecorderService.recording();
        t.setState(on ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        t.setLabel("อัดเสียง");
        t.setSubtitle(on ? (RecorderService.paused ? "พักอยู่" : "กำลังอัด") : "แปะไว้");
        t.updateTile();
    }
}
