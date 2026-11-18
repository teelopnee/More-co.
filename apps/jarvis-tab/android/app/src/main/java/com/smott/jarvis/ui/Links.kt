package com.smott.jarvis.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * เปิดลิงก์ในเบราว์เซอร์
 * newWindow = true → ใน DeX/หน้าจอแยก จะเปิดเป็นหน้าต่างใหม่ข้าง ๆ (FLAG_ACTIVITY_LAUNCH_ADJACENT)
 */
fun Context.openExternal(url: String, newWindow: Boolean) {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (newWindow) {
        intent.addFlags(Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT or Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
    }
    try {
        startActivity(intent)
    } catch (e: ActivityNotFoundException) {
        // ไม่มีเบราว์เซอร์ — ไม่ทำอะไร
    }
}
