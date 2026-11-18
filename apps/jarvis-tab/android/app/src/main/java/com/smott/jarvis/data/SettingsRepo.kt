package com.smott.jarvis.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class AppSettings(
    val llmBaseUrl: String = DEFAULT_BASE_URL,
    val llmModel: String = DEFAULT_MODEL,
    val llmKey: String = "",
    val tavilyKey: String = "",
    val finnhubKey: String = "",
    val twelveDataKey: String = "",
    val voiceLanguage: String = "th-TH",
    val speakAnswers: Boolean = true,
    val conversationMode: Boolean = false,
    /** ฟังคำว่า "Hey Jarvis" (ประมวลผลในเครื่อง) */
    val wakeEnabled: Boolean = true,
    /** ฟังต่อแม้สลับไปแอปอื่น (มีการแจ้งเตือนค้างไว้) */
    val wakeBackground: Boolean = false,
    /** เกณฑ์คะแนน: ต่ำ = ไวขึ้น (แต่ปลุกผิดบ่อยขึ้น) */
    val wakeThreshold: Float = 0.5f,
    /** ถูกเรียกตอนจอล็อก: แสดง Jarvis บนหน้าล็อกเลย (ไม่ต้องปลดล็อกก่อน) */
    val wakeOverLock: Boolean = false,
    /** เล่นคลิปในแผงอัตโนมัติ (ปิดเสียง) */
    val autoplayVideos: Boolean = true,
) {
    companion object {
        const val DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"

        /** ชื่อนี้บน OpenRouter จะชี้ไปที่ Claude Sonnet รุ่นล่าสุดเสมอ — เปลี่ยนได้ในหน้าตั้งค่า */
        const val DEFAULT_MODEL = "~anthropic/claude-sonnet-latest"
    }
}

/** เก็บการตั้งค่าในเครื่อง — API key เข้ารหัสด้วย Android Keystore */
class SettingsRepo(context: Context) {
    private val prefs = context.getSharedPreferences("jarvis_settings", Context.MODE_PRIVATE)
    private val box = SecretBox()
    private val _state = MutableStateFlow(load())
    val state: StateFlow<AppSettings> = _state.asStateFlow()

    fun update(transform: (AppSettings) -> AppSettings) {
        val next = transform(_state.value)
        save(next)
        _state.value = next
    }

    private fun load(): AppSettings {
        val d = AppSettings()
        return AppSettings(
            llmBaseUrl = prefs.getString(K_BASE, null) ?: d.llmBaseUrl,
            llmModel = prefs.getString(K_MODEL, null) ?: d.llmModel,
            llmKey = secret(K_LLM),
            tavilyKey = secret(K_TAVILY),
            finnhubKey = secret(K_FINNHUB),
            twelveDataKey = secret(K_TWELVE),
            voiceLanguage = prefs.getString(K_VOICE, null) ?: d.voiceLanguage,
            speakAnswers = prefs.getBoolean(K_SPEAK, d.speakAnswers),
            conversationMode = prefs.getBoolean(K_CONVO, d.conversationMode),
            wakeEnabled = prefs.getBoolean(K_WAKE, d.wakeEnabled),
            wakeBackground = prefs.getBoolean(K_WAKE_BG, d.wakeBackground),
            wakeThreshold = prefs.getFloat(K_WAKE_TH, d.wakeThreshold).coerceIn(0.2f, 0.9f),
            wakeOverLock = prefs.getBoolean(K_WAKE_LOCK, d.wakeOverLock),
            autoplayVideos = prefs.getBoolean(K_AUTOPLAY, d.autoplayVideos),
        )
    }

    private fun save(s: AppSettings) {
        prefs.edit()
            .putString(K_BASE, s.llmBaseUrl.trim())
            .putString(K_MODEL, s.llmModel.trim())
            .putString(K_LLM, box.encrypt(s.llmKey.trim()))
            .putString(K_TAVILY, box.encrypt(s.tavilyKey.trim()))
            .putString(K_FINNHUB, box.encrypt(s.finnhubKey.trim()))
            .putString(K_TWELVE, box.encrypt(s.twelveDataKey.trim()))
            .putString(K_VOICE, s.voiceLanguage)
            .putBoolean(K_SPEAK, s.speakAnswers)
            .putBoolean(K_CONVO, s.conversationMode)
            .putBoolean(K_WAKE, s.wakeEnabled)
            .putBoolean(K_WAKE_BG, s.wakeBackground)
            .putFloat(K_WAKE_TH, s.wakeThreshold)
            .putBoolean(K_WAKE_LOCK, s.wakeOverLock)
            .putBoolean(K_AUTOPLAY, s.autoplayVideos)
            .apply()
    }

    private fun secret(key: String): String = prefs.getString(key, null)?.let { box.decrypt(it) }.orEmpty()

    private companion object {
        const val K_BASE = "llm_base"
        const val K_MODEL = "llm_model"
        const val K_LLM = "llm_key"
        const val K_TAVILY = "tavily_key"
        const val K_FINNHUB = "finnhub_key"
        const val K_TWELVE = "twelve_key"
        const val K_VOICE = "voice_lang"
        const val K_SPEAK = "speak_answers"
        const val K_CONVO = "conversation_mode"
        const val K_WAKE = "wake_enabled"
        const val K_WAKE_BG = "wake_background"
        const val K_WAKE_TH = "wake_threshold"
        const val K_WAKE_LOCK = "wake_over_lock"
        const val K_AUTOPLAY = "autoplay_videos"
    }
}

/** AES-GCM ด้วยกุญแจใน Android Keystore (กุญแจไม่ออกจากชิปความปลอดภัยของเครื่อง) */
private class SecretBox(private val alias: String = "jarvis_settings_key") {

    fun encrypt(plain: String): String {
        if (plain.isEmpty()) return ""
        return runCatching {
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
            val data = Base64.encodeToString(cipher.doFinal(plain.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
            "$iv:$data"
        }.getOrDefault("")
    }

    fun decrypt(stored: String): String? {
        if (stored.isEmpty()) return ""
        return runCatching {
            val (iv, data) = stored.split(':', limit = 2)
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            String(cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)), Charsets.UTF_8)
        }.getOrNull()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    private companion object {
        const val TRANSFORM = "AES/GCM/NoPadding"
    }
}
