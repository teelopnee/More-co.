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
import com.smott.jarvis.core.keys.KeyChecker
import com.smott.jarvis.data.AppSettings
import com.smott.jarvis.research.ResearchRunner
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
        val c = candidates.takeIf { it.first == candidateKey(s) }?.second.orEmpty()
        if (s.llmProvider == AppSettings.PROVIDER_GEMINI) {
            val primary = s.geminiModel.trim().ifBlank { c.firstOrNull() ?: "gemini-flash-latest" }
            LlmConfig(ModelCatalog.GEMINI_BASE, s.geminiKey, primary, fallbacks = (c - primary).take(5))
        } else {
            LlmConfig(s.llmBaseUrl, s.llmKey, s.llmModel, fallbacks = (c - s.llmModel).take(2))
        }
    }

    /** รุ่นสำรองตามลำดับ (จากรายชื่อสดของผู้ให้บริการ) ใช้เมื่อรุ่นหลักไม่ว่างหรือโควตาฟรีหมด */
    @Volatile
    private var candidates: Pair<String, List<String>> = "" to emptyList()

    private fun candidateKey(s: AppSettings) = "${s.llmProvider}|${s.activeLlmKey.hashCode()}|${s.llmModel}"

    /** ดึงรายชื่อรุ่นครั้งแรกที่ถาม (และเมื่อเปลี่ยนคีย์/ผู้ให้บริการ) — ดึงไม่ได้ก็ใช้รุ่นที่ตั้งไว้ต่อ */
    suspend fun ensureModel() {
        val s = settings.state.value
        val key = candidateKey(s)
        if (candidates.first == key || s.activeLlmKey.isBlank()) return
        val list = runCatching {
            when {
                s.llmProvider == AppSettings.PROVIDER_GEMINI -> ModelCatalog.geminiCandidates(ModelCatalog.geminiModels(http, s.geminiKey))
                s.llmModel.endsWith(":free") -> ModelCatalog.openRouterFreeModels(http).take(4)
                else -> emptyList()
            }
        }.getOrNull() ?: return
        candidates = key to list
    }

    /** ตรวจคีย์ในหน้าตั้งค่า */
    val keys = KeyChecker(http)

    /** ลำดับรุ่น Gemini ที่จะใช้ (สำหรับให้เลือกในหน้าตั้งค่า) */
    suspend fun geminiOrder(key: String): List<String> = ModelCatalog.geminiCandidates(ModelCatalog.geminiModels(http, key))

    @Volatile
    private var openRouterCache: Pair<Long, List<ModelCatalog.Choice>>? = null

    /** รายชื่อรุ่น OpenRouter พร้อมราคา (จำไว้ 10 นาที) */
    suspend fun openRouterChoices(): List<ModelCatalog.Choice> {
        openRouterCache?.let { (at, list) -> if (System.currentTimeMillis() - at < 10 * 60_000L && list.isNotEmpty()) return list }
        val list = ModelCatalog.openRouterChoices(http)
        openRouterCache = System.currentTimeMillis() to list
        return list
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

    /** งานค้นคำตอบ + บทสนทนา (อยู่ระดับแอป จึงค้นต่อได้แม้ปิดหน้าจอแอป) */
    val research = ResearchRunner(app, agent, sessions, prepare = { ensureModel() }, appVisible = { wake.appVisible })

    private val ogCache = ConcurrentHashMap<String, String>()

    /** รูปปกข่าวจาก og:image ของหน้าเว็บ (แคชไว้ ไม่ดึงซ้ำ) */
    suspend fun ogImage(url: String): String? {
        ogCache[url]?.let { return it.ifEmpty { null } }
        val image = runCatching { pages.ogImage(url) }.getOrNull()
        ogCache[url] = image.orEmpty()
        return image
    }
}
