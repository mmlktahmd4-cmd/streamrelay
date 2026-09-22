package com.streamrelay.tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.streamrelay.tv.ui.Bg
import com.streamrelay.tv.ui.HomeScreen
import com.streamrelay.tv.ui.LoginScreen
import com.streamrelay.tv.ui.PlayerScreen
import com.streamrelay.tv.ui.ServerScreen
import com.streamrelay.tv.ui.StreamRelayTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

sealed class Screen {
    data object Server : Screen()
    data class Login(val message: String = "") : Screen()
    data object Home : Screen()
    data class Player(val channel: Channel, val playlist: List<Channel>) : Screen()
}

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Api.prefs = Prefs(this)

        setContent {
            StreamRelayTheme {
                Box(Modifier.fillMaxSize().background(Bg)) {
                    AppRoot()
                }
            }
        }
    }
}

@Composable
private fun AppRoot() {
    val prefs = Api.prefs
    var screen by remember {
        mutableStateOf<Screen>(
            when {
                prefs.serverUrl.isBlank() -> Screen.Server
                !prefs.isLoggedIn -> Screen.Login()
                else -> Screen.Home
            }
        )
    }

    // فقدان الجلسة (دخول من جهاز آخر / انتهاء الحساب) → شاشة الدخول برسالة واضحة
    LaunchedEffect(Unit) {
        Api.onSessionLost = { msg ->
            screen = Screen.Login(msg)
        }
    }

    // نبضة حضور كل 45ث ما دام المستخدم داخل التطبيق (كما تفعل بوابة الويب)
    val loggedIn = screen is Screen.Home || screen is Screen.Player
    if (loggedIn) {
        var resumed by remember { mutableStateOf(true) }
        LifecycleResumeEffect(Unit) {
            resumed = true
            onPauseOrDispose { resumed = false }
        }
        LaunchedEffect(resumed) {
            while (isActive && resumed) {
                try { Api.presence() } catch (_: Exception) { }
                delay(45_000)
            }
        }
    }

    when (val s = screen) {
        is Screen.Server -> ServerScreen(
            onConnected = { screen = Screen.Login() },
            canGoBack = prefs.serverUrl.isNotBlank(),
            onBack = { screen = if (prefs.isLoggedIn) Screen.Home else Screen.Login() },
        )
        is Screen.Login -> LoginScreen(
            initialMessage = s.message,
            onLoggedIn = { screen = Screen.Home },
            onChangeServer = { screen = Screen.Server },
        )
        is Screen.Home -> HomeScreen(
            onPlay = { ch, list -> screen = Screen.Player(ch, list) },
            onChangeServer = { screen = Screen.Server },
            onLogout = {
                Api.logout()
                screen = Screen.Login()
            },
        )
        is Screen.Player -> {
            BackHandler { screen = Screen.Home }
            PlayerScreen(
                initial = s.channel,
                playlist = s.playlist,
                onExit = { screen = Screen.Home },
            )
        }
    }
}
