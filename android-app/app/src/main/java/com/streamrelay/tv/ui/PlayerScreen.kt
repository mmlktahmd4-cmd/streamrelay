package com.streamrelay.tv.ui

import android.app.Activity
import android.content.pm.ActivityInfo
import android.view.View
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.streamrelay.tv.Api
import com.streamrelay.tv.ApiException
import com.streamrelay.tv.Channel
import com.streamrelay.tv.Playback
import com.streamrelay.tv.player.PlaybackResolver
import com.streamrelay.tv.player.PlayerFactory
import com.streamrelay.tv.player.QualityLevel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(initial: Channel, playlist: List<Channel>, onExit: () -> Unit) {
    val context = LocalContext.current
    val activity = context as? Activity
    val view = LocalView.current
    val scope = rememberCoroutineScope()

    var current by remember { mutableStateOf(initial) }
    val index = playlist.indexOfFirst { it.id == current.id }
    val hasPrev = index > 0
    val hasNext = index >= 0 && index < playlist.size - 1

    val player = remember { PlayerFactory.create(context) }
    val released = remember { booleanArrayOf(false) }
    var status by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var playback by remember { mutableStateOf<Playback?>(null) }
    var levels by remember { mutableStateOf<List<QualityLevel>>(emptyList()) }
    var group by remember { mutableStateOf<Tracks.Group?>(null) }
    var manualIndex by remember { mutableIntStateOf(-1) } // -1 = تلقائي
    var playingHeight by remember { mutableIntStateOf(0) }
    var controlsVisible by remember { mutableStateOf(true) }
    var qualityMenu by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    var autoRetries by remember { mutableIntStateOf(0) }

    // ── أفقي + ملء الشاشة + إبقاء الشاشة مضاءة، وتحرير المشغّل عند الخروج ──
    DisposableEffect(Unit) {
        val window = activity?.window
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        view.keepScreenOn = true
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        controller?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller?.hide(WindowInsetsCompat.Type.systemBars())
        onDispose {
            view.keepScreenOn = false
            controller?.show(WindowInsetsCompat.Type.systemBars())
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            released[0] = true
            player.release()
        }
    }

    // ── مستمع المشغّل: الجودات، الدقّة الفعلية، الأخطاء (إعادة محاولة تلقائية) ──
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY) {
                    status = ""
                    error = ""
                    autoRetries = 0
                }
                if (playbackState == Player.STATE_ENDED && current.isVod) {
                    // التشغيل التلقائي للفيديو التالي في نفس القسم (يُحسب من الحالة الحالية،
                    // لأن هذا المستمع يُنشأ مرة واحدة ولا يرى قيم التركيب اللاحقة)
                    val i = playlist.indexOfFirst { it.id == current.id }
                    if (i >= 0 && i < playlist.size - 1) current = playlist[i + 1]
                }
            }

            override fun onTracksChanged(tracks: Tracks) {
                val (g, l) = PlayerFactory.qualityLevels(tracks)
                group = g
                levels = l
            }

            override fun onVideoSizeChanged(videoSize: VideoSize) {
                if (videoSize.height > 0) playingHeight = videoSize.height
            }

            override fun onPlayerError(e: PlaybackException) {
                // انقطاع/انتهاء الرابط/تعثّر الإقلاع: نعيد طلب رابط التشغيل من اللوحة (يعيد
                // تشغيل قناة On Demand إن توقفت) ثم نعيد التحضير — بلا تدخّل من المستخدم.
                if (autoRetries < 40) {
                    autoRetries += 1
                    status = "انقطع البث — إعادة المحاولة (${autoRetries})…"
                    scope.launch {
                        delay(if (autoRetries < 5) 1500 else 3000)
                        attempt += 1
                    }
                } else {
                    status = ""
                    error = "تعذّر متابعة البث — تحقّق من الاتصال ثم أعد المحاولة"
                }
            }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }

    // ── إيقاف مؤقت في الخلفية، والعودة إلى الحافة الحية عند الرجوع ──
    val resumePlay = remember { booleanArrayOf(false) }
    LifecycleResumeEffect(current.id) {
        if (resumePlay[0] && player.mediaItemCount > 0 && !player.isPlaying) {
            // بث مباشر: نعود إلى الحافة الحية بدل متابعة مقاطع قديمة قد تكون حُذفت
            if (!current.isVod) player.seekToDefaultPosition()
            player.play()
        }
        onPauseOrDispose {
            if (!released[0]) {
                resumePlay[0] = player.playWhenReady
                player.pause()
            }
        }
    }

    // ── سلسلة التشغيل: رابط من اللوحة → (انتظار إقلاع On Demand) → تحضير المشغّل ──
    LaunchedEffect(current.id, attempt) {
        error = ""
        status = if (current.isVod) "جاري التحضير…" else "جاري الاتصال بالقناة…"
        levels = emptyList()
        group = null
        manualIndex = -1
        playingHeight = 0
        playback = null
        player.stop()
        player.clearMediaItems()
        PlayerFactory.selectAuto(player)

        var pb: Playback? = null
        var tries = 0
        while (isActive) {
            try {
                val r = Api.playbackUrl(current.id)
                if (r.starting && !current.isVod) {
                    tries += 1
                    status = r.note.ifBlank { "جاري تشغيل القناة على السيرفر — انتظر ثوانٍ" }
                    if (tries > 45) { error = "تأخّر تشغيل القناة على السيرفر — أعد المحاولة"; status = ""; return@LaunchedEffect }
                    delay(2000)
                    continue
                }
                pb = r
                break
            } catch (e: ApiException) {
                when (e.code) {
                    409 -> { error = "القناة متوقفة حالياً — اطلب من الإدارة تشغيلها"; status = ""; return@LaunchedEffect }
                    401, 403, 404 -> { error = e.message ?: "غير مسموح"; status = ""; return@LaunchedEffect }
                    else -> {
                        tries += 1
                        status = e.message ?: "السيرفر مشغول — إعادة المحاولة…"
                        if (tries > 30) { error = e.message ?: "تعذّر تشغيل القناة"; status = ""; return@LaunchedEffect }
                        delay(2500)
                    }
                }
            } catch (_: Exception) {
                tries += 1
                status = "تعذّر الاتصال بالسيرفر — إعادة المحاولة…"
                if (tries > 30) { error = "تعذّر الاتصال بالسيرفر — تحقّق من الشبكة"; status = ""; return@LaunchedEffect }
                delay(2500)
            }
        }
        val p = pb ?: return@LaunchedEffect
        if (p.url.isBlank()) { error = "لا يوجد رابط تشغيل لهذا المحتوى"; status = ""; return@LaunchedEffect }
        val url = PlaybackResolver.resolve(p)
        playback = p
        status = "جاري التحميل…"
        player.setMediaItem(PlayerFactory.mediaItem(url, live = p.type != "vod"))
        player.prepare()
        player.playWhenReady = true
    }

    // ── نبضة مشاهدة كل 30ث لقنوات On Demand ──
    LaunchedEffect(playback?.onDemand, current.id) {
        if (playback?.onDemand != true) return@LaunchedEffect
        while (isActive) {
            try { Api.pulse(current.id) } catch (_: Exception) { }
            delay(30_000)
        }
    }

    val qualityLabel = buildString {
        append(if (playingHeight > 0) "${playingHeight}p" else "—")
        if (levels.size > 1) append(if (manualIndex == -1) " · تلقائي" else " · يدوي")
    }

    // داخل apply يشير الاسم player إلى خاصية PlayerView نفسها — نلتقط مشغّلنا باسم مختلف
    val exoPlayer = player
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    this.player = exoPlayer
                    useController = true
                    controllerAutoShow = true
                    controllerShowTimeoutMs = 4000
                    setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS)
                    setShowNextButton(false)
                    setShowPreviousButton(false)
                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    setControllerVisibilityListener(
                        PlayerView.ControllerVisibilityListener { v -> controlsVisible = v == View.VISIBLE }
                    )
                }
            },
            modifier = Modifier.fillMaxSize(),
        )

        // ── الشريط العلوي (يظهر مع أدوات التحكم) ──
        if (controlsVisible || error.isNotBlank()) {
            Row(
                Modifier.fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color(0xDD000000), Color.Transparent)))
                    .padding(horizontal = 6.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onExit) {
                    Icon(Icons.Default.Close, contentDescription = "خروج", tint = Color.White)
                }
                Column(Modifier.weight(1f)) {
                    Text(current.name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        (if (current.isVod) "فيلم" else if (playback?.onDemand == true) "بث عند الطلب" else "بث مباشر") + "  •  الجودة: $qualityLabel",
                        color = Color(0xFFCBD5E1), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                if (hasPrev) TextButton(onClick = { current = playlist[index - 1] }) { Text("السابق", color = Color.White) }
                if (hasNext) TextButton(onClick = { current = playlist[index + 1] }) { Text("التالي", color = Color.White) }
                if (levels.size > 1) {
                    Box {
                        TextButton(onClick = { qualityMenu = true }) {
                            Text(if (manualIndex == -1) "الجودة: تلقائي" else "الجودة: ${levels.firstOrNull { it.index == manualIndex }?.label ?: ""}", color = Teal, fontWeight = FontWeight.Bold)
                        }
                        DropdownMenu(expanded = qualityMenu, onDismissRequest = { qualityMenu = false }) {
                            DropdownMenuItem(
                                text = { Text(if (manualIndex == -1) "✓ تلقائي (يُنصح به)" else "تلقائي (يُنصح به)") },
                                onClick = { qualityMenu = false; manualIndex = -1; PlayerFactory.selectAuto(player) },
                            )
                            levels.forEach { lvl ->
                                DropdownMenuItem(
                                    text = { Text((if (manualIndex == lvl.index) "✓ " else "") + lvl.label) },
                                    onClick = {
                                        qualityMenu = false
                                        val g = group
                                        if (g != null) { manualIndex = lvl.index; PlayerFactory.selectQuality(player, g, lvl.index) }
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }

        // ── رسالة الحالة (إقلاع/إعادة محاولة) ──
        if (status.isNotBlank() && error.isBlank()) {
            Column(
                Modifier.align(Alignment.Center).clip(RoundedCornerShape(12.dp)).background(Color(0xAA000000)).padding(18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CircularProgressIndicator(color = Teal, modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
                Spacer(Modifier.height(10.dp))
                Text(status, color = Color.White, fontSize = 14.sp, textAlign = TextAlign.Center)
            }
        }

        // ── خطأ نهائي ──
        if (error.isNotBlank()) {
            Column(
                Modifier.align(Alignment.Center).clip(RoundedCornerShape(12.dp)).background(Color(0xCC000000)).padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(error, color = Danger, fontSize = 15.sp, textAlign = TextAlign.Center)
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(onClick = { autoRetries = 0; attempt += 1 }) { Text("إعادة المحاولة") }
                    TextButton(onClick = onExit) { Text("رجوع", color = Color.White) }
                }
                Spacer(Modifier.width(1.dp))
            }
        }
    }
}
