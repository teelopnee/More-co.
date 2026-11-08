package com.moreco.paewai;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * "อัดเสียง แปะไว้": a launcher icon, home-screen shortcut and Quick Settings tile that start
 * recording at once (and stop it when tapped again). Assign it to the side key's double press
 * (Settings → Advanced features → Side button) to record from anywhere. It has no screen of its own.
 */
public class RecordActivity extends Activity {
    private static final int REQ = 21;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (RecorderService.recording()) {
            startService(RecorderService.intent(this, RecorderService.STOP));
            Toast.makeText(this, "หยุดและบันทึกเสียงแล้ว", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        List<String> need = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.RECORD_AUDIO);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.POST_NOTIFICATIONS);
        if (need.isEmpty()) begin();
        else requestPermissions(need.toArray(new String[0]), REQ);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) begin();
        else {
            Toast.makeText(this, "ต้องอนุญาตไมโครโฟนก่อนจึงจะอัดเสียงได้", Toast.LENGTH_LONG).show();
            finish();
        }
    }

    private void begin() {
        try {
            startForegroundService(RecorderService.intent(this, RecorderService.START));
            Toast.makeText(this, "เริ่มอัดเสียงแล้ว · แตะอีกครั้งเพื่อหยุด", Toast.LENGTH_SHORT).show();
        } catch (RuntimeException e) {
            Toast.makeText(this, "เริ่มอัดเสียงไม่ได้", Toast.LENGTH_SHORT).show();
        }
        finish();
    }
}
