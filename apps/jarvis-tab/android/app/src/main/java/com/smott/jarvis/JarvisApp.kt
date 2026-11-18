package com.smott.jarvis

import android.app.Application
import android.content.Context
import com.smott.jarvis.core.agent.Agent
import com.smott.jarvis.core.llm.LlmConfig
import com.smott.jarvis.core.llm.OpenAiCompatClient
import com.smott.jarvis.core.market.MarketService
import com.smott.jarvis.core.net.Http
import com.smott.jarvis.core.providers.FinnhubClient
import com.smott.jarvis.core.providers.PageReader
import com.smott.jarvis.core.providers.TavilyClient
import com.smott.jarvis.core.providers.TwelveDataClient
import com.smott.jarvis.core.tools.MarketNewsTool
import com.smott.jarvis.core.tools.PriceHistoryTool
import com.smott.jarvis.core.tools.QuotesTool
import com.smott.jarvis.core.tools.ReadPageTool
import com.smott.jarvis.core.tools.Tool
import com.smott.jarvis.core.tools.WebSearchTool
import com.smott.jarvis.data.SessionStore
import com.smott.jarvis.data.SettingsRepo
import com.smott.jarvis.device.DeviceTools
import com.smott.jarvis.voice.Speaker
import com.smott.jarvis.voice.SpeechInput
import com.smott.jarvis.wake.WakeController
import com.smott.jarvis.wake.WakeService
import android.content.Intent
import android.provider.Settings
import com.smott.jarvis.core.tools.FindVideosTool
import com.smott.jarvis.core.llm.ModelCatalog
import com.smott.jarvis.data.AppSettings
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class JarvisApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

/** ประกอบชิ้นส่วนทั้งหมดของแอป (อยู่ตลอดอายุแอป) */
class AppContainer(context: Context) {
    private val app = context.applicationContext

    val settings = SettingsRepo(app)

    private val okHttp: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(150, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
    private val http = Http(okHttp)

    private val tavily = TavilyClient(http) { settings.state.value.tavilyKey }
    private val finnhub = FinnhubClient(http) { settings.state.value.finnhubKey }
    private val twelve = TwelveDataClient(http) { settings.state.value.twelveDataKey }
    private val pages = PageReader(http)
    val market = MarketService(finnhub, twelve)

    private val llm = OpenAiCompatClient(http) {
        val s = settings.state.value
        if (s.llmProvider == AppSettings.PROVIDER_GEMINI) {
            LlmConfig(baseUrl = ModelCatalog.GEMINI_BASE, apiKey = s.geminiKey, model = s.geminiModel.ifBlank { "gemini-flash-latest" })
        } else {
            LlmConfig(baseUrl = s.llmBaseUrl, apiKey = s.llmKey, model = s.llmModel)
        }
    }

    /** Gemini: ยังไม่ได้เลือกรุ่น → ดึงรายชื่อจาก Google แล้วเลือก Flash ล่าสุด (จำไว้ ไม่ดึงซ้ำ) */
    suspend fun ensureModel() {
        val s = settings.state.value
        if (s.llmProvider != AppSettings.PROVIDER_GEMINI || s.geminiModel.isNotBlank() || s.geminiKey.isBlank()) return
        val picked = runCatching { ModelCatalog.pickGemini(ModelCatalog.geminiModels(http, s.geminiKey)) }.getOrNull() ?: return
        settings.update { it.copy(geminiModel = picked) }
    }

    /** รายชื่อรุ่นให้เลือกในหน้าตั้งค่า */
    suspend fun modelChoices(provider: String, key: String): List<String> =
        if (provider == AppSettings.PROVIDER_GEMINI) {
            val ids = ModelCatalog.geminiModels(http, key)
            val best = ModelCatalog.pickGemini(ids)
            (listOfNotNull(best) + ids.filter { it.startsWith("gemini") && it.contains("flash") && it != best }).distinct().take(8)
        } else {
            ModelCatalog.openRouterFreeModels(http).take(8)
        }

    private val device = DeviceTools(app)
    private val researchTools: List<Tool> = listOf(
        WebSearchTool(tavily),
        ReadPageTool(tavily, pages),
        QuotesTool(market),
        PriceHistoryTool(market),
        MarketNewsTool(finnhub),
        FindVideosTool(tavily),
    )

    val agent = Agent(llm = llm, tools = { researchTools + device.tools }, market = market)
    val sessions = SessionStore(File(app.filesDir, "sessions"))
    val speech = SpeechInput(app)
    val speaker = Speaker(app)

    /** คำปลุก "Hey Jarvis" — ถูกเรียกตอนแอปไม่ได้อยู่บนจอ → เปิดแอปขึ้นมา */
    val wake = WakeController(app).also { w -> w.onWakeInBackground = { launchForWake() } }

    private fun launchForWake() {
        val intent = Intent(app, MainActivity::class.java)
            .setAction(MainActivity.ACTION_WAKE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        // เปิดแอปจากเบื้องหลังได้เมื่อผู้ใช้อนุญาต "แสดงทับแอปอื่น" ไม่อย่างนั้นเด้งการแจ้งเตือนให้แตะ
        if (Settings.canDrawOverlays(app) && runCatching { app.startActivity(intent) }.isSuccess) return
        WakeService.showWakePrompt(app, intent)
    }

    private val ogCache = ConcurrentHashMap<String, String>()

    /** รูปปกข่าวจาก og:image ของหน้าเว็บ (แคชไว้ ไม่ดึงซ้ำ) */
    suspend fun ogImage(url: String): String? {
        ogCache[url]?.let { return it.ifEmpty { null } }
        val image = runCatching { pages.ogImage(url) }.getOrNull()
        ogCache[url] = image.orEmpty()
        return image
    }
}
