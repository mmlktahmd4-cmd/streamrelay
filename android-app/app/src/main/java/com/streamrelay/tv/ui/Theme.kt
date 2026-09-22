package com.streamrelay.tv.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection

val Teal = Color(0xFF14B8A6)
val TealDark = Color(0xFF0D9488)
val Bg = Color(0xFF0B1220)
val Surface1 = Color(0xFF111A2E)
val Surface2 = Color(0xFF1B2540)
val TextMain = Color(0xFFE5EAF3)
val TextDim = Color(0xFF94A3B8)
val Danger = Color(0xFFF87171)

private val Scheme = darkColorScheme(
    primary = Teal,
    onPrimary = Color.White,
    secondary = TealDark,
    background = Bg,
    onBackground = TextMain,
    surface = Surface1,
    onSurface = TextMain,
    surfaceVariant = Surface2,
    onSurfaceVariant = TextDim,
    error = Danger,
)

@Composable
fun StreamRelayTheme(content: @Composable () -> Unit) {
    // الواجهة عربية بالكامل — نفرض الاتجاه من اليمين لليسار مهما كانت لغة الجهاز
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
        MaterialTheme(colorScheme = Scheme, content = content)
    }
}
