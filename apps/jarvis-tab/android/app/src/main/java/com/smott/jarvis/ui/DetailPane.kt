package com.smott.jarvis.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.OpenInBrowser
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.smott.jarvis.Detail
import com.smott.jarvis.core.model.Session
import com.smott.jarvis.core.tools.hostOf
import com.smott.jarvis.ui.panels.PanelEnv
import com.smott.jarvis.ui.panels.PanelView
import com.smott.jarvis.ui.theme.J

/**
 * แผงด้านข้าง (จอกว้าง) หรือเต็มจอ (จอแคบ):
 * - หน้าเว็บที่มา/ข่าว เปิดอ่านในแอปได้เลย หรือเปิดเป็นหน้าต่างใหม่ใน DeX
 * - แผงคำตอบที่ปักไว้ (เช่นกราฟจากคำถามก่อน) ให้อยู่บนจอตลอดตอนถามต่อ
 */
@Composable
fun DetailPane(
    detail: Detail,
    session: Session,
    env: PanelEnv,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier.background(J.Bg).blockTouches()) {
        when (detail) {
            is Detail.Web -> WebDetail(detail, onClose)
            is Detail.Pinned -> PinnedDetail(detail, session, env, onClose)
        }
    }
}

@Composable
private fun PaneHeader(title: String, subtitle: String, actions: @Composable RowScope.() -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(56.dp).padding(start = 16.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                title,
                style = TextStyle(fontFamily = J.Mono, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = J.Text),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle.isNotBlank()) {
                Text(subtitle, style = J.Small, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        actions()
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(J.Line))
}

private class WebUiState {
    var view: WebView? = null
    var title by mutableStateOf("")
    var url by mutableStateOf("")
    var loading by mutableStateOf(true)
}

@Composable
private fun WebDetail(d: Detail.Web, onClose: () -> Unit) {
    val context = LocalContext.current
    val state = remember { WebUiState().apply { title = d.title; url = d.url } }
    LaunchedEffect(d.url) {
        state.title = d.title
        state.url = d.url
    }
    BackHandler {
        val view = state.view
        if (view != null && view.canGoBack()) view.goBack() else onClose()
    }
    Column(Modifier.fillMaxSize()) {
        PaneHeader(title = state.title.ifBlank { hostOf(state.url) }, subtitle = hostOf(state.url)) {
            SmallIcon(Icons.AutoMirrored.Filled.ArrowBack, "ย้อนกลับ") {
                state.view?.let { if (it.canGoBack()) it.goBack() }
            }
            SmallIcon(Icons.Rounded.Refresh, "โหลดใหม่") { state.view?.reload() }
            SmallIcon(Icons.Outlined.OpenInBrowser, "เปิดในหน้าต่างใหม่") {
                context.openExternal(state.url.ifBlank { d.url }, newWindow = true)
            }
            SmallIcon(Icons.Rounded.Close, "ปิด (Esc)", onClick = onClose)
        }
        if (state.loading) {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth().height(2.dp),
                color = J.Accent,
                trackColor = Color.Transparent,
            )
        }
        AndroidView(
            factory = { ctx -> createWebView(ctx, state, d.url) },
            update = { view ->
                if (view.tag != d.url) {
                    view.tag = d.url
                    view.loadUrl(d.url)
                }
            },
            onRelease = { view ->
                state.view = null
                view.stopLoading()
                view.destroy()
            },
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@SuppressLint("SetJavaScriptEnabled")
private fun createWebView(context: Context, state: WebUiState, url: String): WebView = WebView(context).apply {
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    settings.loadWithOverviewMode = true
    settings.useWideViewPort = true
    settings.builtInZoomControls = true
    settings.displayZoomControls = false
    webViewClient = object : WebViewClient() {
        // อนุญาตเฉพาะ http(s) — ลิงก์แปลก ๆ (intent://, market:// ฯลฯ) ไม่ถูกเปิด
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
            val scheme = request?.url?.scheme ?: return false
            return scheme != "http" && scheme != "https"
        }

        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
            state.loading = true
            if (url != null) state.url = url
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            state.loading = false
            view?.title?.takeIf { it.isNotBlank() }?.let { state.title = it }
        }
    }
    tag = url
    state.view = this
    loadUrl(url)
}

@Composable
private fun PinnedDetail(d: Detail.Pinned, session: Session, env: PanelEnv, onClose: () -> Unit) {
    val turn = session.turns.firstOrNull { it.id == d.turnId }
    BackHandler(onBack = onClose)
    Column(Modifier.fillMaxSize()) {
        PaneHeader(title = "ปักไว้ · ${d.kind.label}", subtitle = turn?.question.orEmpty()) {
            SmallIcon(Icons.Rounded.Close, "ปิด (Esc)", onClick = onClose)
        }
        if (turn == null) {
            Text("ไม่พบข้อมูลของแผงนี้แล้ว", style = J.Small, modifier = Modifier.padding(16.dp))
        } else {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                PanelView(d.kind, turn, env, Modifier.fillMaxWidth(), large = true)
            }
        }
    }
}
