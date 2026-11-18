package com.smott.jarvis.ui.panels

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.OpenInFull
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale
import coil3.compose.AsyncImage
import com.smott.jarvis.core.model.AnalysisBlock
import com.smott.jarvis.core.model.ChartRange
import com.smott.jarvis.core.model.Factor
import com.smott.jarvis.core.model.NewsRef
import com.smott.jarvis.core.model.Overview
import com.smott.jarvis.core.model.Recommendation
import com.smott.jarvis.core.model.Source
import com.smott.jarvis.core.model.SourceKind
import com.smott.jarvis.core.model.Turn
import com.smott.jarvis.ui.HudFrame
import com.smott.jarvis.ui.LocalAppearDelay
import com.smott.jarvis.ui.LocalTileLabel
import com.smott.jarvis.ui.LocalTileFocused
import com.smott.jarvis.ui.RunTile
import com.smott.jarvis.ui.Pill
import com.smott.jarvis.ui.changeColor
import com.smott.jarvis.ui.clock
import com.smott.jarvis.ui.effectGlyph
import com.smott.jarvis.ui.moodLabel
import com.smott.jarvis.ui.pct
import com.smott.jarvis.ui.price
import com.smott.jarvis.ui.riskLabel
import com.smott.jarvis.ui.theme.J
import com.smott.jarvis.ui.timeAgo

enum class PanelKind(val label: String, val code: String) {
    OVERVIEW("ภาพรวม", "BRIEF"),
    CHART("กราฟ", "CHART"),
    QUOTES("ราคาล่าสุด", "QUOTES"),
    NEWS("ข่าวที่เกี่ยวข้อง", "NEWS"),
    FACTORS("ปัจจัยที่ส่งผล", "FACTORS"),
    ANALYSIS("บทวิเคราะห์", "ANALYSIS"),
    RECOMMENDATIONS("คำแนะนำ", "ACTIONS"),
    SOURCES("ที่มา", "SOURCES"),
    IMAGE("ภาพ", "IMAGE"),
    STAT("ตัวเลขสำคัญ", "STAT"),
    TEXT("บทวิเคราะห์", "TEXT"),
    FIGURE("กราฟข้อมูล", "DATA"),
    VIDEO("คลิป", "VIDEO"),
    RESEARCH("กำลังค้น", "RESEARCH"),
    INCOMING("ที่มาล่าสุด", "INCOMING");

    /** หัวแผงแบบ HUD เช่น "BRIEF // ภาพรวม" */
    val header: String get() = "$code // $label"
}

/** แผง 1 ใบในโมเสก: ชนิด + กว้างกี่คอลัมน์ + ตัวระบุเพิ่มเติม (เช่น id ของที่มาสำหรับแผงภาพ) */
data class Tile(val kind: PanelKind, val span: Int, val arg: String? = null) {
    val key: String get() = tileKey(kind, arg)
}

fun tileKey(kind: PanelKind, arg: String? = null) = "${kind.name}:${arg.orEmpty()}"

/** การกระทำที่แผงต่าง ๆ เรียกได้ (เปิดที่มา, ปักแผง, เปลี่ยนช่วงกราฟ ฯลฯ) */
@Stable
class PanelEnv(
    val source: (String) -> Source?,
    val openSource: (String) -> Unit,
    val openUrl: (String, String) -> Unit,
    val pin: (String, PanelKind) -> Unit,
    val changeRange: (String, ChartRange) -> Unit,
    val isChartLoading: (String) -> Boolean,
    val ogImage: suspend (String) -> String?,
    /** แผงที่กำลังถูกอธิบายด้วยเสียง: (turnId) → key ของแผง */
    val focus: (String) -> String? = { null },
    /** เล่นคลิปในแผงอัตโนมัติ (ปิดเสียง) */
    val autoplayVideos: Boolean = true,
)

fun hasChart(turn: Turn): Boolean {
    val chart = turn.briefing?.chart ?: return false
    return chart.symbols.isNotEmpty() && turn.series.any { it.symbol in chart.symbols }
}

/** แผงที่มีข้อมูลในคำตอบนี้ + ความกว้าง (จำนวนคอลัมน์) — เรียงให้โมเสกแน่นแบบจอ HUD */
fun panelsFor(turn: Turn): List<Tile> {
    val b = turn.briefing ?: return emptyList()
    return buildList {
        if (b.overview != null) add(Tile(PanelKind.OVERVIEW, 1))
        b.stats.indices.forEach { add(Tile(PanelKind.STAT, 1, "$it")) }
        b.videos.take(3).forEach { add(Tile(PanelKind.VIDEO, 2, it.sourceId)) }
        b.analysis.indices.forEach { add(Tile(PanelKind.TEXT, 1, "$it")) }
        b.figures.indices.forEach { add(Tile(PanelKind.FIGURE, 1, "$it")) }
        if (hasChart(turn)) add(Tile(PanelKind.CHART, 2))
        if (b.watchlist.any { s -> turn.quotes.any { it.symbol == s } }) add(Tile(PanelKind.QUOTES, 1))
        if (b.news.isNotEmpty()) add(Tile(PanelKind.NEWS, 1))
        if (b.factors.isNotEmpty()) add(Tile(PanelKind.FACTORS, 1))
        if (b.recommendations.isNotEmpty()) add(Tile(PanelKind.RECOMMENDATIONS, 1))
        imageTiles(turn, b.news.map { it.sourceId }).forEach { add(it) }
    }
}

/** ภาพ: ข่าวที่มีภาพปก + ภาพประกอบจากการค้น รวมไม่เกิน 4 ภาพ */
private fun imageTiles(turn: Turn, newsIds: List<String>): List<Tile> {
    val news = newsIds.mapNotNull { id -> turn.sources.firstOrNull { it.id == id && it.imageUrl != null && it.videoId == null } }
        .distinctBy { it.id }.take(2).map { Tile(PanelKind.IMAGE, 1, it.id) }
    val photos = turn.images.indices.map { Tile(PanelKind.IMAGE, 1, "i$it") }
    return (news + photos).take(4)
}

/** ระหว่างค้น: แผง RESEARCH + คลิป/ภาพ/ที่มาที่ทยอยเข้ามา (จอค่อย ๆ เต็มเหมือนในคลิปอ้างอิง) */
fun liveTilesFor(turn: Turn): List<Tile> = buildList {
    add(Tile(PanelKind.RESEARCH, 1))
    turn.sources.filter { it.videoId != null }.take(2).forEach { add(Tile(PanelKind.VIDEO, 2, it.id)) }
    if (turn.sources.any { it.videoId == null }) add(Tile(PanelKind.INCOMING, 1))
    turn.images.indices.take(4).forEach { add(Tile(PanelKind.IMAGE, 1, "i$it")) }
    turn.sources.filter { it.imageUrl != null && it.videoId == null }.take(2).forEach { add(Tile(PanelKind.IMAGE, 1, it.id)) }
}

/** จัดแผงลงแถวแบบ first-fit แล้วยืดแผงสุดท้ายให้เต็มแถว — ได้โมเสกที่ไม่มีช่องว่าง */
fun packRows(items: List<Tile>, columns: Int): List<List<Tile>> {
    val remaining = items.map { it.copy(span = it.span.coerceIn(1, columns)) }.toMutableList()
    val rows = mutableListOf<List<Tile>>()
    while (remaining.isNotEmpty()) {
        val row = mutableListOf<Tile>()
        var free = columns
        val iter = remaining.iterator()
        while (iter.hasNext() && free > 0) {
            val item = iter.next()
            if (item.span <= free) {
                row += item
                free -= item.span
                iter.remove()
            }
        }
        if (free > 0 && row.isNotEmpty()) {
            val last = row.removeAt(row.lastIndex)
            row += last.copy(span = last.span + free)
        }
        rows += row
    }
    return rows
}

private fun pinOrNull(large: Boolean, action: () -> Unit): (() -> Unit)? = if (large) null else action

@Composable
fun PanelGrid(turn: Turn, columns: Int, env: PanelEnv, live: Boolean = false) {
    val tiles = remember(turn.briefing, turn.series, turn.quotes, turn.sources, turn.images, turn.status, live) {
        if (live) liveTilesFor(turn) else panelsFor(turn)
    }
    // เลขลำดับ "03/11" ตามลำดับเดิม ไม่ว่าแผงจะไปอยู่ฝั่งไหน
    val numbers = remember(tiles) { tiles.withIndex().associate { (i, t) -> t to i + 1 } }
    val media = tiles.filter { it.kind == PanelKind.VIDEO || it.kind == PanelKind.IMAGE }
    val rest = tiles.filterNot { it.kind == PanelKind.VIDEO || it.kind == PanelKind.IMAGE }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (columns >= 3 && media.isNotEmpty() && rest.isNotEmpty()) {
            // จอกว้าง: แผงข้อความ/ตัวเลข/กราฟอยู่ซ้าย คลิปกับภาพเรียงซ้อนทางขวา (แบบจอในคลิปอ้างอิง)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Column(Modifier.weight((columns - 2).toFloat()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    TileRows(turn, rest, columns - 2, env, live, numbers)
                }
                Column(Modifier.weight(2f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    TileRows(turn, media, 2, env, live, numbers)
                }
            }
        } else {
            TileRows(turn, tiles, columns, env, live, numbers)
        }
        if (!live) SourcesPanel(turn, env, Modifier.fillMaxWidth())
    }
}

@Composable
private fun TileRows(turn: Turn, tiles: List<Tile>, columns: Int, env: PanelEnv, live: Boolean, numbers: Map<Tile, Int>) {
    val rows = remember(tiles, columns) { packRows(tiles, columns) }
    val total = numbers.size
    val focusKey = env.focus(turn.id)
    rows.forEach { row ->
        Row(
            Modifier.fillMaxWidth().height(IntrinsicSize.Max),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            row.forEach { tile ->
                // packRows อาจยืด span ของแผงสุดท้าย จึงหาเลขจาก kind+arg
                val n = numbers.entries.firstOrNull { it.key.kind == tile.kind && it.key.arg == tile.arg }?.value ?: 0
                CompositionLocalProvider(
                    LocalAppearDelay provides if (live) 0 else (n - 1).coerceAtLeast(0) * 140,
                    LocalTileLabel provides String.format(Locale.US, "%02d/%02d", n, total),
                    LocalTileFocused provides (focusKey != null && focusKey == tile.key),
                ) {
                    PanelView(tile.kind, turn, env, Modifier.weight(tile.span.toFloat()).fillMaxHeight(), arg = tile.arg, live = live)
                }
            }
        }
    }
}

@Composable
fun PanelView(
    kind: PanelKind,
    turn: Turn,
    env: PanelEnv,
    modifier: Modifier = Modifier,
    large: Boolean = false,
    arg: String? = null,
    live: Boolean = false,
) {
    // แผงที่ใช้ได้ระหว่างค้น (ยังไม่มีคำตอบ)
    when (kind) {
        PanelKind.RESEARCH -> return RunTile(turn, modifier)
        PanelKind.INCOMING -> return IncomingPanel(turn, env, modifier)
        PanelKind.VIDEO -> {
            val src = arg?.let { id -> turn.sources.firstOrNull { it.id == id } ?: env.source(id) } ?: return
            val why = turn.briefing?.videos?.firstOrNull { it.sourceId == arg }?.why.orEmpty()
            return VideoPanel(src, why, env, modifier, play = !live && env.autoplayVideos)
        }
        PanelKind.IMAGE -> {
            if (arg != null && arg.startsWith("i")) {
                val img = arg.drop(1).toIntOrNull()?.let { turn.images.getOrNull(it) } ?: return
                return PhotoPanel(img, modifier)
            }
            val src = arg?.let { id -> turn.sources.firstOrNull { it.id == id } ?: env.source(id) } ?: return
            return ImagePanel(src, env, modifier)
        }
        else -> Unit
    }
    val b = turn.briefing ?: return
    when (kind) {
        PanelKind.OVERVIEW -> b.overview?.let { OverviewPanel(turn, b.title, it, env, modifier, large) }
        PanelKind.CHART -> b.chart?.let { ChartPanel(turn, it, env, modifier, large) }
        PanelKind.QUOTES -> QuotesPanel(turn, b.watchlist, env, modifier, large)
        PanelKind.NEWS -> NewsPanel(turn, b.news, env, modifier, large)
        PanelKind.FACTORS -> FactorsPanel(turn, b.factors, env, modifier, large)
        PanelKind.ANALYSIS -> AnalysisPanel(turn, b.analysis, env, modifier, large)
        PanelKind.RECOMMENDATIONS -> RecommendationsPanel(turn, b.recommendations, env, modifier, large)
        PanelKind.SOURCES -> SourcesPanel(turn, env, modifier, expandedByDefault = true)
        PanelKind.STAT -> arg?.toIntOrNull()?.let { b.stats.getOrNull(it) }?.let { StatPanel(it, env, modifier) }
        PanelKind.TEXT -> arg?.toIntOrNull()?.let { i -> b.analysis.getOrNull(i)?.let { TextPanel(it, i, b.analysis.size, env, modifier) } }
        PanelKind.FIGURE -> arg?.toIntOrNull()?.let { b.figures.getOrNull(it) }?.let { FigurePanel(it, env, modifier) }
        PanelKind.IMAGE, PanelKind.VIDEO, PanelKind.RESEARCH, PanelKind.INCOMING -> Unit
    }
}

@Composable
fun PanelCard(
    title: String,
    modifier: Modifier = Modifier,
    onPin: (() -> Unit)? = null,
    trailing: @Composable RowScope.() -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    HudFrame(
        header = title,
        modifier = modifier,
        headerTrailing = {
            trailing()
            if (onPin != null) {
                Icon(
                    Icons.Outlined.OpenInFull,
                    contentDescription = "ปักไว้ด้านข้าง",
                    tint = J.Muted,
                    modifier = Modifier.size(24.dp).clip(CircleShape).clickable(onClick = onPin).padding(5.dp),
                )
            }
        },
        content = content,
    )
}

/** ข้อความพร้อมเลขอ้างอิง [1] [3] ที่กดแล้วเปิดแหล่งที่มา */
@Composable
fun CitedText(
    text: String,
    sources: List<String>,
    onSource: (String) -> Unit,
    style: TextStyle = J.Body,
    modifier: Modifier = Modifier,
) {
    val open by rememberUpdatedState(onSource)
    val annotated = remember(text, sources) {
        buildAnnotatedString {
            append(text)
            sources.forEach { id ->
                append(" ")
                withLink(
                    LinkAnnotation.Clickable(
                        tag = id,
                        styles = TextLinkStyles(style = SpanStyle(color = J.Accent, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)),
                        linkInteractionListener = { open(id) },
                    )
                ) {
                    append("[${id.removePrefix("S")}]")
                }
            }
        }
    }
    Text(annotated, style = style, modifier = modifier)
}

@Composable
private fun Bullet(content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Box(Modifier.padding(top = 8.dp).size(5.dp).background(J.Rose))
        Spacer(Modifier.width(10.dp))
        Box(Modifier.weight(1f)) { content() }
    }
}

@Composable
fun OverviewPanel(turn: Turn, title: String, o: Overview, env: PanelEnv, modifier: Modifier, large: Boolean) {
    PanelCard(PanelKind.OVERVIEW.header, modifier, onPin = pinOrNull(large) { env.pin(turn.id, PanelKind.OVERVIEW) }) {
        val (moodText, moodColor) = moodLabel(o.mood)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Pill(moodText, moodColor)
            if (title.isNotBlank()) {
                Spacer(Modifier.width(8.dp))
                Text(title, style = J.Small, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Spacer(Modifier.height(10.dp))
        Text(
            o.headline.uppercase(),
            style = TextStyle(fontFamily = J.Mono, 
                fontSize = if (large) 22.sp else 17.sp,
                lineHeight = if (large) 30.sp else 24.sp,
                fontWeight = FontWeight.Bold,
                color = J.Text,
            ),
        )
        Spacer(Modifier.height(8.dp))
        o.points.forEach { p -> Bullet { CitedText(p.text, p.sources, env.openSource) } }
    }
}

@Composable
fun QuotesPanel(turn: Turn, watchlist: List<String>, env: PanelEnv, modifier: Modifier, large: Boolean) {
    val quotes = watchlist.mapNotNull { s -> turn.quotes.firstOrNull { it.symbol == s } }
    PanelCard(PanelKind.QUOTES.header, modifier, onPin = pinOrNull(large) { env.pin(turn.id, PanelKind.QUOTES) }) {
        quotes.forEach { q ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { env.openUrl("https://finance.yahoo.com/quote/${q.symbol}", q.symbol) }
                    .padding(vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    q.symbol,
                    style = TextStyle(fontFamily = J.Mono, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = J.Text),
                    modifier = Modifier.width(68.dp),
                )
                Text(
                    price(q.price),
                    style = TextStyle(fontFamily = J.Mono, fontSize = 14.sp, color = J.Text, textAlign = TextAlign.End),
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    pct(q.changePct),
                    style = TextStyle(fontFamily = J.Mono, 
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        color = changeColor(q.changePct),
                        textAlign = TextAlign.End,
                    ),
                    modifier = Modifier.width(76.dp),
                )
            }
        }
        val latest = quotes.maxOfOrNull { it.time } ?: 0L
        Spacer(Modifier.height(6.dp))
        Text(
            if (latest > 0) "Finnhub · ${clock(latest)}" else "Finnhub",
            style = J.Small.copy(color = J.Faint),
        )
    }
}

@Composable
fun NewsPanel(turn: Turn, refs: List<NewsRef>, env: PanelEnv, modifier: Modifier, large: Boolean) {
    val items = refs.mapNotNull { r -> env.source(r.sourceId)?.let { it to r.why } }
    PanelCard(PanelKind.NEWS.header, modifier, onPin = pinOrNull(large) { env.pin(turn.id, PanelKind.NEWS) }) {
        items.forEachIndexed { i, (src, why) ->
            if (i > 0) HorizontalDivider(color = J.Hud.copy(alpha = 0.18f), thickness = 1.dp, modifier = Modifier.padding(vertical = 4.dp))
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .clickable { env.openUrl(src.url, src.title) }
                    .padding(vertical = 6.dp),
            ) {
                NewsThumb(src, env)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        src.title,
                        style = TextStyle(fontFamily = J.Mono, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium, color = J.Text),
                        maxLines = if (large) 3 else 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    val meta = listOf(src.publisher, timeAgo(src.publishedAt)).filter { it.isNotBlank() }.joinToString(" · ")
                    Text("$meta  [${src.id.removePrefix("S")}]", style = J.Small, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (why.isNotBlank()) {
                        Text(why, style = J.Small, maxLines = if (large) 4 else 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@Composable
private fun NewsThumb(src: Source, env: PanelEnv) {
    val image by produceState(initialValue = src.imageUrl, src.url) {
        if (value == null) value = env.ogImage(src.url)
    }
    Box(
        Modifier.size(64.dp).clip(RoundedCornerShape(2.dp)).background(J.SurfaceHi),
        contentAlignment = Alignment.Center,
    ) {
        val url = image
        if (url != null) {
            AsyncImage(
                model = url,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Text(
                src.publisher.take(1).uppercase(),
                style = TextStyle(fontFamily = J.Mono, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = J.Faint),
            )
        }
    }
}

@Composable
fun FactorsPanel(turn: Turn, factors: List<Factor>, env: PanelEnv, modifier: Modifier, large: Boolean) {
    PanelCard(PanelKind.FACTORS.header, modifier, onPin = pinOrNull(large) { env.pin(turn.id, PanelKind.FACTORS) }) {
        factors.forEach { f ->
            val (glyph, color) = effectGlyph(f.effect)
            Row(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                Text(glyph, color = color, fontSize = 11.sp, modifier = Modifier.padding(top = 3.dp).width(20.dp))
                Column(Modifier.weight(1f)) {
                    Text(f.name, style = TextStyle(fontFamily = J.Mono, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = J.Text))
                    if (f.detail.isNotBlank()) {
                        CitedText(
                            f.detail,
                            f.sources,
                            env.openSource,
                            style = J.Body.copy(fontSize = 14.sp, lineHeight = 21.sp, color = J.Muted),
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun AnalysisPanel(turn: Turn, blocks: List<AnalysisBlock>, env: PanelEnv, modifier: Modifier, large: Boolean) {
    PanelCard(PanelKind.ANALYSIS.header, modifier, onPin = pinOrNull(large) { env.pin(turn.id, PanelKind.ANALYSIS) }) {
        blocks.forEachIndexed { i, block ->
            if (i > 0) Spacer(Modifier.height(12.dp))
            if (block.heading.isNotBlank()) {
                Text(block.heading, style = TextStyle(fontFamily = J.Mono, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = J.Text))
                Spacer(Modifier.height(4.dp))
            }
            CitedText(block.body, block.sources, env.openSource)
        }
    }
}

@Composable
fun RecommendationsPanel(turn: Turn, recs: List<Recommendation>, env: PanelEnv, modifier: Modifier, large: Boolean) {
    PanelCard(
        PanelKind.RECOMMENDATIONS.header,
        modifier,
        onPin = pinOrNull(large) { env.pin(turn.id, PanelKind.RECOMMENDATIONS) },
    ) {
        recs.forEachIndexed { i, r ->
            val (riskText, riskColor) = riskLabel(r.risk)
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Text(
                    "${i + 1}",
                    style = TextStyle(fontFamily = J.Mono, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = J.Accent),
                    modifier = Modifier.padding(top = 2.dp).width(20.dp),
                )
                Column(Modifier.weight(1f)) {
                    CitedText(r.text, r.sources, env.openSource, style = J.Body.copy(fontSize = 14.sp, lineHeight = 21.sp))
                    Spacer(Modifier.height(4.dp))
                    Pill(riskText, riskColor)
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        Text("ข้อมูลทั่วไป ไม่ใช่คำแนะนำการลงทุนเฉพาะบุคคล", style = J.Small.copy(color = J.Faint))
    }
}

@Composable
fun SourcesPanel(turn: Turn, env: PanelEnv, modifier: Modifier = Modifier, expandedByDefault: Boolean = false) {
    val ids = remember(turn.briefing, turn.sources) {
        ((turn.briefing?.citedIds() ?: emptySet()) + turn.sources.map { it.id })
            .sortedBy { it.removePrefix("S").toIntOrNull() ?: Int.MAX_VALUE }
    }
    val list = ids.mapNotNull { env.source(it) }
    var expanded by rememberSaveable(turn.id) { mutableStateOf(expandedByDefault) }
    if (list.isEmpty()) return
    val shown = if (expanded) list else list.take(4)

    PanelCard(
        "${PanelKind.SOURCES.header} · ${list.size}",
        modifier,
        trailing = {
            if (list.size > 4) {
                Text(
                    if (expanded) "ย่อ" else "ดูทั้งหมด",
                    style = J.Small.copy(color = J.Accent),
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .clickable { expanded = !expanded }
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
        },
    ) {
        shown.forEach { s -> SourceRow(s, env) }
    }
}

@Composable
private fun SourceRow(s: Source, env: PanelEnv) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .clickable { env.openUrl(s.url, s.title) }
            .padding(vertical = 6.dp),
    ) {
        Text(
            "[${s.id.removePrefix("S")}]",
            style = J.Small.copy(color = J.Accent),
            modifier = Modifier.width(40.dp),
        )
        Column(Modifier.weight(1f)) {
            Text(
                s.title,
                style = TextStyle(fontFamily = J.Mono, fontSize = 13.sp, color = J.Text),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            val kind = when (s.kind) {
                SourceKind.WEB -> "เว็บ"
                SourceKind.NEWS -> "ข่าว"
                SourceKind.DATA -> "ข้อมูลตลาด"
                SourceKind.VIDEO -> "คลิป"
            }
            Text(
                listOf(kind, s.publisher, timeAgo(s.publishedAt)).filter { it.isNotBlank() }.joinToString(" · "),
                style = J.Small,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** แผงภาพข่าวเต็มแผง มีคำบรรยายสั้น ๆ ที่ขอบล่าง (แตะเพื่อเปิดข่าว) */
@Composable
fun ImagePanel(src: Source, env: PanelEnv, modifier: Modifier = Modifier) {
    HudFrame(
        header = "${PanelKind.IMAGE.code} // ${src.publisher.ifBlank { src.title }}",
        modifier = modifier,
        padding = 10.dp,
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 150.dp)
                .weight(1f, fill = false)
                .clip(RoundedCornerShape(2.dp))
                .background(J.SurfaceHi)
                .clickable { env.openUrl(src.url, src.title) },
        ) {
            AsyncImage(
                model = src.imageUrl,
                contentDescription = src.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth().heightIn(min = 150.dp).height(170.dp),
            )
            Text(
                src.title,
                style = TextStyle(fontFamily = J.Mono, fontSize = 11.sp, lineHeight = 15.sp, color = J.Text),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .background(J.Bg.copy(alpha = 0.72f))
                    .padding(horizontal = 8.dp, vertical = 5.dp),
            )
        }
    }
}
