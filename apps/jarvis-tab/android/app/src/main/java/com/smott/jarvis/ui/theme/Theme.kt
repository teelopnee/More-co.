package com.smott.jarvis.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.smott.jarvis.R

/**
 * โทน HUD ไซไฟ: พื้นดำน้ำเงิน + กรอบแผงสีฟ้านีออน + ลูกแก้วสีชมพูแดง
 * ตัวอักษรเป็น monospace (JetBrains Mono, OFL) ภาษาไทยใช้ฟอนต์ไทยของระบบแทน
 */
object J {
    val Bg = Color(0xFF03070D)
    val Glow = Color(0xFF0B3C5E)
    val Surface = Color(0xFF02060B)
    val SurfaceHi = Color(0xFF08182A)
    val Line = Color(0xFF16344D)
    val Hud = Color(0xFF59C4F5)
    val HudHi = Color(0xFFBFEBFF)
    val Text = Color(0xFFF1F7FB)
    val Muted = Color(0xFF86AEC6)
    val Faint = Color(0xFF4F7189)
    val Accent = Color(0xFF5FD0FF)
    val Rose = Color(0xFFFF2E63)
    val RoseHi = Color(0xFFFF9BB8)
    val Up = Color(0xFF3DF2A5)
    val Down = Color(0xFFFF5577)
    val Warn = Color(0xFFFFC145)
    val Series = listOf(Accent, Warn, Color(0xFFB69CFF), Rose)

    val Mono = FontFamily(
        Font(R.font.jetbrains_mono, FontWeight.Normal),
        Font(R.font.jetbrains_mono_bold, FontWeight.Bold),
    )

    val Label = TextStyle(fontFamily = Mono, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp, color = Muted)
    val Body = TextStyle(fontFamily = Mono, fontSize = 13.sp, lineHeight = 20.sp, color = Text)
    val Small = TextStyle(fontFamily = Mono, fontSize = 11.sp, lineHeight = 16.sp, color = Muted)
}

@Composable
fun JarvisTheme(content: @Composable () -> Unit) {
    val base = Typography()
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = J.Accent,
            onPrimary = J.Bg,
            secondary = J.Accent,
            background = J.Bg,
            onBackground = J.Text,
            surface = J.Surface,
            onSurface = J.Text,
            surfaceVariant = J.SurfaceHi,
            onSurfaceVariant = J.Muted,
            outline = J.Line,
            error = J.Down,
        ),
        typography = base.copy(
            bodyLarge = base.bodyLarge.copy(fontFamily = J.Mono),
            bodyMedium = base.bodyMedium.copy(fontFamily = J.Mono),
            bodySmall = base.bodySmall.copy(fontFamily = J.Mono),
            labelLarge = base.labelLarge.copy(fontFamily = J.Mono),
            labelMedium = base.labelMedium.copy(fontFamily = J.Mono),
            labelSmall = base.labelSmall.copy(fontFamily = J.Mono),
        ),
        content = content,
    )
}
