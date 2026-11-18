package com.smott.jarvis

import android.Manifest
import android.app.KeyguardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import com.smott.jarvis.ui.JarvisRoot
import com.smott.jarvis.ui.theme.JarvisTheme

class MainActivity : ComponentActivity() {

    private val vm: MainViewModel by viewModels()

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        reportVisibility(true)
        if (granted) vm.toggleMic() else vm.notify("ต้องอนุญาตไมโครโฟนก่อนจึงจะสั่งด้วยเสียงได้")
    }

    /** ขอสิทธิ์ครั้งแรก: ไมค์ (ฟัง "Hey Jarvis") + การแจ้งเตือน (แสดงว่ากำลังฟังอยู่) */
    private val firstPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        reportVisibility(true)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        setContent {
            JarvisTheme {
                JarvisRoot(vm = vm, onMic = ::onMicPressed)
            }
        }
        if (savedInstanceState == null) {
            askFirstPermissions()
            handleLaunch(intent)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLaunch(intent)
    }

    override fun onStart() {
        super.onStart()
        reportVisibility(true)
    }

    override fun onStop() {
        reportVisibility(false)
        super.onStop()
    }

    private fun micGranted() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun reportVisibility(visible: Boolean) = vm.onVisibility(visible, micGranted())

    private fun askFirstPermissions() {
        if (!vm.settings.value.wakeEnabled) return
        val wanted = buildList {
            if (!micGranted()) add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (wanted.isNotEmpty()) firstPermissions.launch(wanted.toTypedArray())
    }

    /**
     * เปิดจาก "Hey Jarvis" (ACTION_WAKE), ปุ่มผู้ช่วย (ASSIST) หรือทางลัดที่ส่ง listen=true → ทักทายแล้วฟังทันที
     * ถ้าจอดับอยู่ให้เปิดจอ; แสดงบนหน้าล็อกเฉพาะเมื่อผู้ใช้เปิดตัวเลือกนี้ ไม่อย่างนั้นขอให้ปลดล็อกก่อน
     */
    private fun handleLaunch(intent: Intent?) {
        val action = intent?.action
        val wake = action == ACTION_WAKE
        val wantsVoice = wake || action == Intent.ACTION_ASSIST || intent?.getBooleanExtra(EXTRA_LISTEN, false) == true
        if (!wantsVoice) return
        if (wake) {
            setTurnScreenOn(true)
            val overLock = vm.settings.value.wakeOverLock
            setShowWhenLocked(overLock)
            if (overLock) getSystemService(KeyguardManager::class.java)?.requestDismissKeyguard(this, null)
        }
        window.decorView.postDelayed({
            if (vm.isListening()) return@postDelayed
            if (!micGranted()) {
                micPermission.launch(Manifest.permission.RECORD_AUDIO)
                return@postDelayed
            }
            if (wake || action == Intent.ACTION_ASSIST) vm.onWake() else vm.toggleMic()
        }, 300)
    }

    private fun onMicPressed() {
        if (micGranted()) vm.toggleMic() else micPermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    /** คีย์ลัดสำหรับคีย์บอร์ด (โหมด DeX): Ctrl+J พูด, Ctrl+K พิมพ์, Ctrl+N เซสชันใหม่, Ctrl+L เคลียร์จอ, Esc ปิดแผงข้าง */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            if (event.isCtrlPressed) {
                when (event.keyCode) {
                    KeyEvent.KEYCODE_J -> { onMicPressed(); return true }
                    KeyEvent.KEYCODE_K -> { vm.requestInputFocus(); return true }
                    KeyEvent.KEYCODE_N -> { vm.newSession(); return true }
                    KeyEvent.KEYCODE_L -> { vm.clearView(); return true }
                    KeyEvent.KEYCODE_PERIOD -> { vm.stop(); return true }
                }
            }
            if (event.keyCode == KeyEvent.KEYCODE_ESCAPE && vm.detail.value != null) {
                vm.closeDetail()
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    companion object {
        const val EXTRA_LISTEN = "listen"
        const val ACTION_WAKE = "com.smott.jarvis.WAKE"
    }
}
