package com.smott.jarvis.core.agent

import com.smott.jarvis.core.JarvisJson
import com.smott.jarvis.core.llm.ChatMessage
import com.smott.jarvis.core.llm.LlmClient
import com.smott.jarvis.core.llm.ToolCall
import com.smott.jarvis.core.llm.ToolChoice
import com.smott.jarvis.core.market.MarketService
import com.smott.jarvis.core.market.isValidSymbol
import com.smott.jarvis.core.market.normalizeSymbol
import com.smott.jarvis.core.model.AnalysisBlock
import com.smott.jarvis.core.model.Briefing
import com.smott.jarvis.core.model.ChartRange
import com.smott.jarvis.core.model.ChartSpec
import com.smott.jarvis.core.model.MediaImage
import com.smott.jarvis.core.model.NewsRef
import com.smott.jarvis.core.model.Overview
import com.smott.jarvis.core.model.PriceSeries
import com.smott.jarvis.core.model.Quote
import com.smott.jarvis.core.model.Source
import com.smott.jarvis.core.model.SourceKind
import com.smott.jarvis.core.model.TraceStep
import com.smott.jarvis.core.model.Turn
import com.smott.jarvis.core.net.resultOf
import com.smott.jarvis.core.tools.Tool
import com.smott.jarvis.core.tools.finnhubSource
import com.smott.jarvis.core.tools.parseArgs
import com.smott.jarvis.core.tools.toDef
import com.smott.jarvis.core.tools.twelveDataSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import java.time.Instant

data class AgentResult(
    val briefing: Briefing,
    val newSources: List<Source>,
    val quotes: List<Quote>,
    val series: List<PriceSeries>,
    val images: List<MediaImage> = emptyList(),
)

/**
 * วงจรการทำงาน 1 คำถาม:
 * คิด → เรียกเครื่องมือ (ค้นเว็บ/ราคา/ข่าว พร้อมกันได้) → คิดต่อ … → present_briefing
 * จากนั้นตรวจคำตอบ: ตัดที่มาที่ไม่มีจริง และดึงตัวเลขกราฟ/ราคาที่ยังขาดจาก API เอง
 */
class Agent(
    private val llm: LlmClient,
    private val tools: () -> List<Tool>,
    private val market: MarketService,
    private val maxSteps: Int = 10,
) {
    suspend fun run(
        question: String,
        history: List<Turn>,
        onProgress: (sources: List<Source>, images: List<MediaImage>) -> Unit = { _, _ -> },
        onTrace: (List<TraceStep>) -> Unit,
    ): AgentResult {
        val earlier = history.flatMap { it.sources }
        val ctx = ResearchContext(earlier)
        ctx.onChange = { onProgress(ctx.newSources(), ctx.images()) }
        val trace = Trace(onTrace)

        val all = tools()
        val active = all.filter { it.available }
        val byName = active.associateBy { it.name }
        val allDefs = active.map { it.toDef() } + BriefingSchema.def
        val researchDefs = active.filterNot { it.device }.map { it.toDef() } + BriefingSchema.def
        // หลังจากผลค้นเว็บเข้ามาในบทสนทนาแล้ว จะไม่ส่งเครื่องมือสั่งอุปกรณ์ให้โมเดลอีก
        var readWeb = false
        var badBriefings = 0
        val unavailable = all.filterNot { it.available }
            .map { if (it.requires.isBlank()) it.name else "${it.name} (${it.requires})" }

        val messages = mutableListOf<ChatMessage>()
        messages += ChatMessage(role = "system", content = Prompts.system(Instant.now(), unavailable, earlier))
        messages += Prompts.history(history)
        messages += ChatMessage(role = "user", content = question)

        var briefing: Briefing? = null
        var mustFinish = false
        var lastText = ""

        for (step in 0 until maxSteps) {
            val forceFinal = mustFinish || step == maxSteps - 1
            val label = when {
                step == 0 -> "วางแผน"
                forceFinal -> "จัดหน้าสรุป"
                else -> "วิเคราะห์ข้อมูล"
            }
            val idx = trace.add(label)
            val reply = try {
                llm.complete(
                    messages = messages,
                    tools = if (readWeb) researchDefs else allDefs,
                    toolChoice = if (forceFinal) ToolChoice.force(BriefingSchema.NAME) else ToolChoice.Auto,
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                trace.fail(idx, "")
                throw e
            }
            trace.done(idx)

            val text = reply.content?.trim().orEmpty()
            if (text.isNotEmpty()) lastText = text
            val calls: List<ToolCall> = reply.toolCalls.orEmpty().mapIndexed { i, c ->
                if (c.id.isBlank()) c.copy(id = "call_${step}_$i") else c
            }

            if (calls.isEmpty()) {
                // โมเดลตอบเป็นข้อความเฉย ๆ — ขอให้จัดหน้าสรุป 1 ครั้ง ถ้ายังไม่ทำก็ใช้ข้อความนั้น
                if (mustFinish) break
                messages += ChatMessage(role = "assistant", content = text.ifEmpty { "…" })
                messages += ChatMessage(role = "user", content = "Now call ${BriefingSchema.NAME} with your final answer for the screen.")
                mustFinish = true
                continue
            }

            messages += ChatMessage(role = "assistant", content = text.ifEmpty { null }, toolCalls = calls, extraContent = reply.extraContent)

            val final = calls.firstOrNull { it.function.name == BriefingSchema.NAME }
            if (final != null) {
                briefing = parseBriefing(final.function.arguments)
                if (briefing != null) break
                // JSON เสีย (มักเพราะคำตอบยาวจนถูกตัด) ให้ลองใหม่ได้ครั้งเดียว แล้วใช้คำตอบสำรอง — ไม่เรียกโมเดลซ้ำจนเปลืองเงิน
                if (++badBriefings >= 2) break
                calls.forEach { c ->
                    messages += ChatMessage(
                        role = "tool",
                        toolCallId = c.id,
                        content = if (c === final) "ERROR: arguments did not match the schema. Call ${BriefingSchema.NAME} again with valid JSON." else "skipped",
                    )
                }
                mustFinish = true
                continue
            }

            val blockDevice = readWeb
            val results = coroutineScope {
                calls.mapIndexed { i, call ->
                    async {
                        when {
                            i >= MAX_PARALLEL -> "ERROR: too many tool calls in one step; this one was skipped"
                            blockDevice && byName[call.function.name]?.device == true ->
                                "ERROR: device commands are disabled after reading web content. Ask the user to say the command directly."
                            else -> execute(call, byName, ctx, trace)
                        }
                    }
                }.awaitAll()
            }
            if (calls.any { byName[it.function.name]?.device == false }) readWeb = true
            calls.zip(results).forEach { (call, result) ->
                messages += ChatMessage(role = "tool", toolCallId = call.id, content = result)
            }
        }

        val raw = briefing ?: fallback(question, lastText)
        val finished = finish(raw, ctx, trace)
        ctx.onChange = null
        return AgentResult(finished, ctx.newSources(), ctx.quotes(), ctx.allSeries(), ctx.images())
    }

    private suspend fun execute(call: ToolCall, byName: Map<String, Tool>, ctx: ResearchContext, trace: Trace): String {
        val tool = byName[call.function.name] ?: return "ERROR: unknown tool ${call.function.name}"
        val args = parseArgs(call.function.arguments)
        val (label, detail) = tool.traceLabel(args)
        val idx = trace.add(label, detail)
        return try {
            val out = withTimeout(TOOL_TIMEOUT_MS) { tool.run(args, ctx) }
            trace.done(idx)
            out
        } catch (e: TimeoutCancellationException) {
            trace.fail(idx, "หมดเวลา")
            "ERROR: tool timed out"
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            trace.fail(idx, e.message?.take(80).orEmpty())
            "ERROR: ${e.message?.take(300) ?: e.javaClass.simpleName}"
        }
    }

    private fun parseBriefing(raw: String): Briefing? {
        val element = runCatching { JarvisJson.parseToJsonElement(raw.ifBlank { "{}" }) }.getOrNull() as? JsonObject
            ?: return null
        val obj = element["briefing"] as? JsonObject ?: element
        return runCatching { JarvisJson.decodeFromJsonElement(Briefing.serializer(), obj) }.getOrNull()
            ?.takeIf { it.title.isNotBlank() || it.overview != null || it.analysis.isNotEmpty() }
    }

    private fun fallback(question: String, text: String): Briefing = Briefing(
        title = question.take(80),
        spoken = text.take(300),
        overview = Overview(
            headline = if (text.isBlank()) "ยังสรุปคำตอบไม่ได้ ลองถามใหม่อีกครั้ง" else text.lineSequence().first().take(160),
        ),
        analysis = if (text.isBlank()) emptyList() else listOf(AnalysisBlock(body = text)),
    )

    /** ตรวจและเติมคำตอบให้ครบก่อนแสดง */
    private suspend fun finish(b: Briefing, ctx: ResearchContext, trace: Trace): Briefing {
        val ids = ctx.ids()
        fun clean(list: List<String>) = list.map { it.trim().uppercase() }.filter { it in ids }.distinct()

        var out = b.copy(
            overview = b.overview?.let { o ->
                o.copy(points = o.points.filter { it.text.isNotBlank() }.map { it.copy(sources = clean(it.sources)) })
            },
            factors = b.factors.filter { it.name.isNotBlank() }.map { it.copy(sources = clean(it.sources)) },
            analysis = b.analysis.filter { it.body.isNotBlank() }.map { it.copy(sources = clean(it.sources)) },
            recommendations = b.recommendations.filter { it.text.isNotBlank() }.map { it.copy(sources = clean(it.sources)) },
            news = b.news.mapNotNull { n ->
                val id = n.sourceId.trim().uppercase()
                ctx.get(id)?.takeIf { it.kind != SourceKind.DATA && it.kind != SourceKind.VIDEO }?.let { n.copy(sourceId = id) }
            }.distinctBy { it.sourceId }.take(8),
            followUps = b.followUps.filter { it.isNotBlank() }.take(4),
            videos = b.videos.mapNotNull { v ->
                val id = v.sourceId.trim().uppercase()
                ctx.get(id)?.takeIf { it.kind == SourceKind.VIDEO && it.videoId != null }?.let { v.copy(sourceId = id) }
            }.distinctBy { it.sourceId }.take(4),
            // ตัวเลขต้องมีที่มาจริงเสมอ ไม่อย่างนั้นตัดทิ้ง
            stats = b.stats.map { it.copy(value = it.value.trim(), sources = clean(it.sources)) }
                .filter { it.value.isNotBlank() && it.value.length <= 24 && it.sources.isNotEmpty() }.take(4),
            figures = b.figures.map { it.copy(sources = clean(it.sources)) }
                .filter { f ->
                    f.sources.isNotEmpty() && f.labels.size == f.values.size && f.values.size in 2..12 &&
                        f.values.all { it.isFinite() } && f.title.isNotBlank()
                }.take(3),
            watchlist = b.watchlist.map(::normalizeSymbol).filter(::isValidSymbol).distinct().take(12),
        )

        // ถ้าโมเดลไม่ได้เลือกข่าว แต่ดึงข่าวมาแล้ว ให้แสดงข่าวล่าสุด
        if (out.news.isEmpty()) {
            val recent = ctx.newSources().filter { it.kind == SourceKind.NEWS }
                .sortedByDescending { it.publishedAt ?: 0L }.take(5)
            if (recent.isNotEmpty()) out = out.copy(news = recent.map { NewsRef(sourceId = it.id) })
        }

        // โมเดลไม่ได้เลือกคลิป แต่หาคลิปมาแล้ว → แสดง 2 คลิปแรก
        if (out.videos.isEmpty()) {
            val clips = ctx.newSources().filter { it.kind == SourceKind.VIDEO && it.videoId != null }.take(2)
            if (clips.isNotEmpty()) out = out.copy(videos = clips.map { NewsRef(sourceId = it.id) })
        }

        out = fillChart(out, ctx, trace)
        out = fillQuotes(out, ctx, trace)
        return out
    }

    private suspend fun fillChart(b: Briefing, ctx: ResearchContext, trace: Trace): Briefing {
        val fetched = ctx.allSeries()
        val spec = b.chart?.takeIf { it.symbols.isNotEmpty() }
            ?: fetched.takeIf { it.isNotEmpty() }?.let { s ->
                ChartSpec(symbols = s.map { it.symbol }.distinct().take(4), range = s.first().range.label)
            }
            ?: return b.copy(chart = null)

        val range = ChartRange.parse(spec.range)
        val symbols = spec.symbols.map(::normalizeSymbol).filter(::isValidSymbol).distinct().take(4)
        if (symbols.isEmpty()) return b.copy(chart = null)

        val missing = symbols.filter { ctx.series(it, range) == null }
        if (missing.isNotEmpty() && market.historyAvailable) {
            val idx = trace.add("ดึงกราฟ", "${missing.joinToString(" ")} · ${range.label}")
            val got = coroutineScope {
                missing.map { s -> async { resultOf { market.history(s, range) }.getOrNull() } }.awaitAll()
            }.filterNotNull()
            got.forEach { ctx.putSeries(it) }
            if (got.isNotEmpty()) ctx.twelveDataSource()
            if (got.size == missing.size) trace.done(idx) else trace.fail(idx, "บางตัวไม่มีข้อมูล")
        }
        val have = symbols.filter { ctx.series(it, range) != null }
        return if (have.isEmpty()) b.copy(chart = null)
        else b.copy(chart = spec.copy(symbols = have, range = range.label))
    }

    private suspend fun fillQuotes(b: Briefing, ctx: ResearchContext, trace: Trace): Briefing {
        val list = b.watchlist.ifEmpty { ctx.quotes().map { it.symbol } }
        if (list.isEmpty()) return b
        val missing = list.filter { ctx.quote(it) == null }
        if (missing.isNotEmpty() && market.quotesAvailable) {
            val idx = trace.add("ดึงราคา", missing.joinToString(" "))
            val results = market.quotes(missing)
            results.values.mapNotNull { it.getOrNull() }.forEach { ctx.putQuote(it) }
            if (results.values.any { it.isSuccess }) ctx.finnhubSource()
            trace.done(idx)
        }
        return b.copy(watchlist = list.filter { ctx.quote(it) != null })
    }

    private companion object {
        const val MAX_PARALLEL = 8
        const val TOOL_TIMEOUT_MS = 45_000L
    }
}
