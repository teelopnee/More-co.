package com.smott.jarvis.ui.panels

import android.annotation.SuppressLint
import android.graphics.Color as AColor
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import coil3.compose.AsyncImage
import com.smott.jarvis.core.model.AnalysisBlock
import com.smott.jarvis.core.model.Figure
import com.smott.jarvis.core.model.MediaImage
import com.smott.jarvis.core.model.Source
import com.smott.jarvis.core.model.Stat
import com.smott.jarvis.core.model.Turn
import com.smott.jarvis.core.tools.VideoRef
import com.smott.jarvis.ui.HudFrame
import com.smott.jarvis.ui.openExternal
import com.smott.jarvis.ui.theme.J
import com.smott.jarvis.ui.timeAgo
import java.util.Locale
import kotlin.math.abs

/** ตัวเลขสำคัญตัวโต เช่น "≈20M" */
@Composable
fun StatPanel(stat: Stat, env: PanelEnv, modifier: Modifier = Modifier) {
    HudFrame(header = "${PanelKind.STAT.code} // ${stat.label}", modifier = modifier) {
        Spacer(Modifier.height(4.dp))
        Text(
            stat.value,
            style = TextStyle(fontFamily = J.Mono, fontSize = 40.sp, lineHeight = 44.sp, fontWeight = FontWeight.Bold, color = J.Text),
            maxLines = 1,
        )
        Spacer(Modifier.height(4.dp))
        CitedText(stat.label, stat.sources, env.openSource, style = J.Small.copy(color = J.Muted, fontSize = 12.sp))
    }
}

/** แบ่งเนื้อหายาวเป็นหน้า ๆ ตัดที่ช่องว่าง (ภาษาไทยไม่มีจุดจบประโยค) */
internal fun pages(text: String, max: Int = 360): List<String> {
    val t = text.trim()
    if (t.length <= max) return listOf(t)
    val out = mutableListOf<String>()
    var rest = t
    while (rest.length > max) {
        var cut = rest.lastIndexOf(' ', max)
        if (cut < max / 2) cut = max
        out += rest.substring(0, cut).trim()
        rest = rest.substring(cut).trim()
    }
    if (rest.isNotEmpty()) out += rest
    return out
}

/** บล็อกข้อความ 1 ใบ: หัวข้อตัวใหญ่ + เนื้อหา (ยาวเกินแบ่งหน้า ◂ ▸ แบบในคลิปอ้างอิง) */
@Composable
fun TextPanel(block: AnalysisBlock, index: Int, total: Int, env: PanelEnv, modifier: Modifier = Modifier) {
    val parts = remember(block.body) { pages(block.body) }
    var page by rememberSaveable(block.heading, block.body) { mutableIntStateOf(0) }
    HudFrame(header = "${PanelKind.TEXT.code} // ${index + 1} OF $total", modifier = modifier) {
        if (block.heading.isNotBlank()) {
            Text(
                block.heading.uppercase(),
                style = TextStyle(fontFamily = J.Mono, fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Bold, color = J.Text),
            )
            Spacer(Modifier.height(6.dp))
        }
        val last = page >= parts.lastIndex
        CitedText(
            parts.getOrElse(page) { "" },
            if (last) block.sources else emptyList(),
            env.openSource,
            style = J.Body.copy(fontSize = 12.sp, lineHeight = 18.sp),
        )
        if (parts.size > 1) {
            Spacer(Modifier.weight(1f, fill = false))
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Pager("◂", enabled = page > 0) { page-- }
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally)) {
                    parts.indices.forEach { i ->
                        Box(Modifier.size(width = if (i == page) 14.dp else 6.dp, height = 3.dp).background(if (i == page) J.Accent else J.Hud.copy(alpha = 0.3f)))
                    }
                }
                Pager("▸", enabled = !last) { page++ }
            }
        }
    }
}

@Composable
private fun Pager(glyph: String, enabled: Boolean, onClick: () -> Unit) {
    Text(
        glyph,
        style = TextStyle(fontFamily = J.Mono, fontSize = 13.sp, color = if (enabled) J.HudHi else J.Faint),
        modifier = Modifier
            .clip(RoundedCornerShape(2.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

private fun num(v: Double): String = when {
    abs(v) >= 100 -> String.format(Locale.US, "%,.0f", v)
    abs(v) >= 10 -> String.format(Locale.US, "%.1f", v)
    else -> String.format(Locale.US, "%.2f", v).trimEnd('0').trimEnd('.')
}

/** กราฟแท่งสีขาวจากตัวเลขในที่มา (แบบ "CHART // ..." ในคลิปอ้างอิง) */
@Composable
fun FigurePanel(fig: Figure, env: PanelEnv, modifier: Modifier = Modifier) {
    val measurer = rememberTextMeasurer()
    val labelStyle = TextStyle(fontFamily = J.Mono, fontSize = 9.sp, color = J.Muted, textAlign = TextAlign.Center)
    val valueStyle = TextStyle(fontFamily = J.Mono, fontSize = 10.sp, fontWeight = FontWeight.Bold, color = J.Text, textAlign = TextAlign.Center)
    HudFrame(header = "${PanelKind.FIGURE.code} // ${fig.title}", modifier = modifier, headerTrailing = {
        if (fig.unit.isNotBlank()) Text(fig.unit.uppercase(), style = J.Label.copy(color = J.Faint))
    }) {
        Canvas(Modifier.fillMaxWidth().height(150.dp)) {
            val n = fig.values.size
            if (n == 0) return@Canvas
            val lo = minOf(0.0, fig.values.min())
            val hi = maxOf(0.0, fig.values.max()).let { if (it - lo < 1e-9) lo + 1 else it }
            val top = 16.dp.toPx()
            val bottom = size.height - 18.dp.toPx()
            val slot = size.width / n
            val barW = slot * 0.56f
            fun y(v: Double) = (bottom - (v - lo) / (hi - lo) * (bottom - top)).toFloat()
            val zero = y(0.0)
            drawLine(J.Hud.copy(alpha = 0.35f), Offset(0f, zero), Offset(size.width, zero), strokeWidth = 1f)
            fig.values.forEachIndexed { i, v ->
                val x = slot * i + (slot - barW) / 2
                val yv = y(v)
                drawRect(Color.White.copy(alpha = 0.92f), Offset(x, minOf(yv, zero)), Size(barW, abs(zero - yv).coerceAtLeast(1f)))
                val tv = measurer.measure(num(v), valueStyle, constraints = Constraints(maxWidth = slot.toInt().coerceAtLeast(1)))
                drawText(tv, topLeft = Offset(slot * i + (slot - tv.size.width) / 2, minOf(yv, zero) - tv.size.height - 1.dp.toPx()))
                val tl = measurer.measure(
                    fig.labels.getOrElse(i) { "" }, labelStyle,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    constraints = Constraints(maxWidth = slot.toInt().coerceAtLeast(1)),
                )
                drawText(tl, topLeft = Offset(slot * i + (slot - tl.size.width) / 2, bottom + 4.dp.toPx()))
            }
        }
        if (fig.note.isNotBlank() || fig.sources.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            CitedText(fig.note, fig.sources, env.openSource, style = J.Small.copy(fontSize = 10.sp, lineHeight = 14.sp, color = J.Faint))
        }
    }
}

/** คลิปวิดีโอเล่นในแผง (ปิดเสียง วนซ้ำ) — แตะ ↗ เพื่อเปิดในแอป YouTube/TikTok */
@Composable
fun VideoPanel(src: Source, why: String, env: PanelEnv, modifier: Modifier = Modifier, play: Boolean = true) {
    val context = LocalContext.current
    val preview = LocalInspectionMode.current
    var playing by remember(src.id) { mutableStateOf(play) }
    HudFrame(
        header = "${PanelKind.VIDEO.code} // ${src.title}",
        modifier = modifier,
        padding = 10.dp,
        headerTrailing = {
            Icon(
                Icons.Outlined.OpenInNew,
                contentDescription = "เปิดคลิป",
                tint = J.Muted,
                modifier = Modifier.size(24.dp).clip(CircleShape).clickable { context.openExternal(src.url, newWindow = true) }.padding(5.dp),
            )
        },
    ) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(2.dp)).background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            val id = src.videoId
            if (playing && !preview && id != null) {
                VideoWeb(src.platform ?: VideoRef.YOUTUBE, id)
            } else {
                if (src.imageUrl != null) {
                    AsyncImage(model = src.imageUrl, contentDescription = src.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                }
                PlayGlyph(Modifier.size(54.dp).clickable { playing = true })
            }
        }
        val caption = why.ifBlank { src.publisher }
        if (caption.isNotBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(caption, style = J.Small.copy(fontSize = 11.sp), maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun PlayGlyph(modifier: Modifier) {
    Canvas(modifier) {
        drawCircle(Color.Black.copy(alpha = 0.55f))
        drawCircle(J.HudHi.copy(alpha = 0.9f), style = androidx.compose.ui.graphics.drawscope.Stroke(1.5.dp.toPx()))
        val r = size.minDimension / 2
        val path = Path().apply {
            moveTo(center.x - r * 0.25f, center.y - r * 0.38f)
            lineTo(center.x + r * 0.42f, center.y)
            lineTo(center.x - r * 0.25f, center.y + r * 0.38f)
            close()
        }
        drawPath(path, J.HudHi)
    }
}

/**
 * WebView ฝังคลิป: YouTube ต้องการ Referer เป็น https://<ชื่อแพ็กเกจแอป> สำหรับแอปที่ใช้ WebView
 * จึงโหลด HTML ด้วย baseUrl นั้น (ตามเอกสาร YouTube "API Client Identity")
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun VideoWeb(platform: String, id: String) {
    val context = LocalContext.current
    val base = "https://${context.packageName}/"
    val src = if (platform == VideoRef.TIKTOK) {
        "https://www.tiktok.com/player/v1/$id?autoplay=1&muted=1&loop=1&controls=1&description=0&music_info=0&rel=0"
    } else {
        "https://www.youtube.com/embed/$id?autoplay=1&mute=1&playsinline=1&loop=1&playlist=$id&rel=0&modestbranding=1"
    }
    val html = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style>
        </head><body><iframe src="$src" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>"""
    AndroidView(
        factory = { ctx ->
            WebView(ctx).apply {
                setBackgroundColor(AColor.BLACK)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                webChromeClient = WebChromeClient()
                webViewClient = object : WebViewClient() {
                    // แตะโลโก้/ชื่อคลิปในเครื่องเล่น → เปิดในแอปภายนอก ไม่เปลี่ยนหน้าในแผง
                    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                        val url = request?.url?.toString() ?: return false
                        if (request.isForMainFrame && !url.startsWith(base)) {
                            ctx.openExternal(url, newWindow = true)
                            return true
                        }
                        return false
                    }
                }
                loadDataWithBaseURL(base, html, "text/html", "utf-8", null)
            }
        },
        onRelease = { web ->
            web.stopLoading()
            web.loadUrl("about:blank")
            web.destroy()
        },
        modifier = Modifier.fillMaxSize(),
    )
}

/** ภาพประกอบจากการค้น */
@Composable
fun PhotoPanel(img: MediaImage, modifier: Modifier = Modifier) {
    HudFrame(header = "${PanelKind.IMAGE.code} // ${img.description.ifBlank { img.query }}", modifier = modifier, padding = 10.dp) {
        Box(Modifier.fillMaxWidth().heightIn(min = 140.dp).height(160.dp).clip(RoundedCornerShape(2.dp)).background(J.SurfaceHi)) {
            AsyncImage(model = img.url, contentDescription = img.description, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
        if (img.description.isNotBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(img.description, style = J.Small.copy(fontSize = 10.sp, lineHeight = 14.sp), maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** ระหว่างค้น: รายการที่มาล่าสุดที่เพิ่งเข้ามา */
@Composable
fun IncomingPanel(turn: Turn, env: PanelEnv, modifier: Modifier = Modifier) {
    val list = turn.sources.filter { it.videoId == null }.takeLast(6).reversed()
    HudFrame(header = "${PanelKind.INCOMING.code} // ${turn.sources.size} SOURCES", modifier = modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            list.forEach { s ->
                Row(Modifier.fillMaxWidth().clickable { env.openUrl(s.url, s.title) }) {
                    Text("[${s.id.removePrefix("S")}]", style = J.Small.copy(color = J.Accent, fontSize = 10.sp), modifier = Modifier.width(34.dp))
                    Column(Modifier.weight(1f)) {
                        Text(s.title, style = TextStyle(fontFamily = J.Mono, fontSize = 11.sp, color = J.Text), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(listOf(s.publisher, timeAgo(s.publishedAt)).filter { it.isNotBlank() }.joinToString(" · "), style = J.Small.copy(fontSize = 9.sp), maxLines = 1)
                    }
                }
            }
        }
    }
}
