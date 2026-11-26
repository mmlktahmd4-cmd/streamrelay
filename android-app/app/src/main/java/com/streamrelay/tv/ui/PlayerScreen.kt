package com.streamrelay.tv.ui

import android.app.Activity
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Build
import android.provider.Settings
import android.view.MotionEvent
import android.view.OrientationEventListener
import android.view.ScaleGestureDetector
import android.view.View
import android.view.WindowManager
import androidx.compose.foundation.layout.displayCutoutPadding
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import coil.compose.AsyncImage
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
    // نسبة العرض في ملء الشاشة (تُحفظ): 0 ملاءمة، 1 ملء الشاشة، 2 تمديد
    var fitMode by remember { mutableIntStateOf(Api.prefs.videoFit) }
    var fitHint by remember { mutableStateOf("") }
    val applyFit: (Int) -> Unit = { m ->
        fitMode = m
        Api.prefs.videoFit = m
        fitHint = fitLabel(m)
    }
    LaunchedEffect(fitHint) {
        if (fitHint.isNotBlank()) { delay(1300); fitHint = "" }
    }

    // ── الاتجاه: يفتح طولياً (الفيديو أعلى الشاشة وتحته القنوات)، وقلب الجوال = ملء الشاشة ──
    // lock: 0 = يتبع الحساس، 1 = مثبّت أفقي (زر ملء الشاشة)، 2 = مثبّت طولي (زر الخروج).
    // يُفك التثبيت تلقائياً حين يصير وضع الجوال الفعلي مطابقاً له — مثل يوتيوب.
    val isLandscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    val lock = remember { intArrayOf(0) }
    // لا نلمس الاتجاه عند فتح القناة: تغيير requestedOrientation يجعل سامسونج يعيد حساب
    // الاتجاه من آخر وضع محفوظ قبل الحساس فتنقلب الشاشة طول/عرض لحظياً (الجلتش).
    // نغيّره فقط عند ضغط زر ملء الشاشة، ونعيد القيمة الأصلية كما هي عند فك التثبيت/الخروج.
    val originalOrientation = remember { activity?.requestedOrientation ?: ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
    val setFullscreen: (Boolean) -> Unit = remember {
        { on: Boolean ->
            lock[0] = if (on) 1 else 2
            activity?.requestedOrientation =
                if (on) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
    }

    DisposableEffect(Unit) {
        view.keepScreenOn = true
        val sensor = object : OrientationEventListener(context) {
            override fun onOrientationChanged(deg: Int) {
                if (deg == ORIENTATION_UNKNOWN || lock[0] == 0) return
                // قفل التدوير مفعّل في الجوال: يبقى الوضع كما اختاره المستخدم بالزر
                val autoRotate = try {
                    Settings.System.getInt(context.contentResolver, Settings.System.ACCELEROMETER_ROTATION, 1) == 1
                } catch (_: Exception) { true }
                if (!autoRotate) return
                val physLand = deg in 60..120 || deg in 240..300
                val physPort = deg <= 25 || deg >= 335 || deg in 155..205
                if ((lock[0] == 1 && physLand) || (lock[0] == 2 && physPort)) {
                    lock[0] = 0
                    activity?.requestedOrientation = originalOrientation
                }
            }
        }
        if (sensor.canDetectOrientation()) sensor.enable()
        onDispose {
            sensor.disable()
            view.keepScreenOn = false
            activity?.window?.let { w ->
                WindowCompat.getInsetsController(w, view).show(WindowInsetsCompat.Type.systemBars())
                WindowCompat.setDecorFitsSystemWindows(w, true)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    w.attributes = w.attributes.apply {
                        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT
                    }
                }
            }
            // نعيد الاتجاه فقط إن كنا غيّرناه بالزر — وإلا لا نلمسه حتى لا تنقلب الشاشة عند الخروج
            if (lock[0] != 0) activity?.requestedOrientation = originalOrientation
            released[0] = true
            player.release()
        }
    }

    // ملء الشاشة = إخفاء أشرطة النظام في الوضع الأفقي فقط، والرسم حتى حافة الشاشة
    // (تحت ثقب الكاميرا/النوتش) — بدونه يترك أندرويد شريطاً أسود على جانب الكاميرا.
    LaunchedEffect(isLandscape) {
        val window = activity?.window ?: return@LaunchedEffect
        WindowCompat.setDecorFitsSystemWindows(window, !isLandscape)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = if (isLandscape)
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT
            }
        }
        val c = WindowCompat.getInsetsController(window, view)
        c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (isLandscape) c.hide(WindowInsetsCompat.Type.systemBars()) else c.show(WindowInsetsCompat.Type.systemBars())
    }

    // الرجوع في ملء الشاشة يعيد الوضع الطولي بدل الخروج من القناة
    BackHandler(enabled = isLandscape) { setFullscreen(false) }

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
    val onAuto: () -> Unit = { manualIndex = -1; PlayerFactory.selectAuto(player) }
    val onPick: (Int) -> Unit = { idx ->
        val g = group
        if (g != null) { manualIndex = idx; PlayerFactory.selectQuality(player, g, idx) }
    }

    Column(
        Modifier.fillMaxSize()
            .background(if (isLandscape) Color.Black else Bg)
            .then(if (isLandscape) Modifier else Modifier.statusBarsPadding()),
    ) {
        // ── الفيديو: نفس المكان في الوضعين حتى لا يُعاد إنشاء المشغّل عند القلب ──
        Box(
            (if (isLandscape) Modifier.fillMaxSize() else Modifier.fillMaxWidth().aspectRatio(16f / 9f))
                .background(Color.Black),
        ) {
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
                        // زر ملء الشاشة داخل شريط التحكم نفسه
                        setFullscreenButtonClickListener { _ ->
                            val land = (activity?.resources?.configuration?.orientation ?: Configuration.ORIENTATION_PORTRAIT) ==
                                Configuration.ORIENTATION_LANDSCAPE
                            setFullscreen(!land)
                        }
                        // قرص بإصبعين (مثل يوتيوب): تكبير = ملء الشاشة، تصغير = ملاءمة — في الوضع الأفقي فقط.
                        // اللمسة الواحدة تمرّ للمشغّل كما هي (إظهار/إخفاء أدوات التحكم).
                        var pinchScale = 1f
                        var pinching = false
                        val detector = ScaleGestureDetector(ctx, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
                            override fun onScaleBegin(d: ScaleGestureDetector): Boolean { pinchScale = 1f; return true }
                            override fun onScale(d: ScaleGestureDetector): Boolean { pinchScale *= d.scaleFactor; return true }
                            override fun onScaleEnd(d: ScaleGestureDetector) {
                                val land = (activity?.resources?.configuration?.orientation ?: Configuration.ORIENTATION_PORTRAIT) ==
                                    Configuration.ORIENTATION_LANDSCAPE
                                if (!land) return
                                if (pinchScale > 1.12f) applyFit(1) else if (pinchScale < 0.89f) applyFit(0)
                            }
                        })
                        setOnTouchListener { _, ev ->
                            detector.onTouchEvent(ev)
                            if (ev.pointerCount > 1) pinching = true
                            val consume = pinching
                            if (ev.actionMasked == MotionEvent.ACTION_UP || ev.actionMasked == MotionEvent.ACTION_CANCEL) pinching = false
                            consume
                        }
                    }
                },
                update = { pv ->
                    pv.setFullscreenButtonState(isLandscape)
                    pv.resizeMode = if (!isLandscape) AspectRatioFrameLayout.RESIZE_MODE_FIT else when (fitMode) {
                        0 -> AspectRatioFrameLayout.RESIZE_MODE_FIT
                        2 -> AspectRatioFrameLayout.RESIZE_MODE_FILL
                        else -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )

            // ── الشريط العلوي فوق الفيديو (يظهر مع أدوات التحكم) ──
            if (controlsVisible || error.isNotBlank()) {
                Row(
                    Modifier.fillMaxWidth()
                        .background(Brush.verticalGradient(listOf(Color(0xCC000000), Color.Transparent)))
                        .then(if (isLandscape) Modifier.displayCutoutPadding() else Modifier)
                        .padding(horizontal = 4.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = { if (isLandscape) setFullscreen(false) else onExit() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع", tint = Color.White)
                    }
                    if (isLandscape) {
                        Column(Modifier.weight(1f)) {
                            Text(current.name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                kindLabel(current, playback?.onDemand == true) + "  •  الجودة: $qualityLabel",
                                color = Color(0xFFCBD5E1), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (hasPrev) TextButton(onClick = { current = playlist[index - 1] }) { Text("السابق", color = Color.White) }
                        if (hasNext) TextButton(onClick = { current = playlist[index + 1] }) { Text("التالي", color = Color.White) }
                        // نسبة العرض: كل ضغطة تنتقل للتالية (ملء الشاشة ← ملاءمة ← تمديد)
                        TextButton(onClick = { applyFit((fitMode + 1) % 3) }) {
                            Text("العرض: ${fitLabel(fitMode)}", color = Teal, fontWeight = FontWeight.Bold)
                        }
                        QualityButton(levels, manualIndex, qualityMenu, { qualityMenu = it }, onAuto, onPick)
                    } else {
                        Spacer(Modifier.weight(1f))
                    }
                }
            }

            // ── اسم نسبة العرض لحظة تغييرها ──
            if (fitHint.isNotBlank()) {
                Text(
                    fitHint, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.align(Alignment.Center).clip(RoundedCornerShape(10.dp))
                        .background(Color(0xAA000000)).padding(horizontal = 18.dp, vertical = 10.dp),
                )
            }

            // ── رسالة الحالة (إقلاع/إعادة محاولة) ──
            if (status.isNotBlank() && error.isBlank()) {
                Column(
                    Modifier.align(Alignment.Center).clip(RoundedCornerShape(12.dp)).background(Color(0xAA000000)).padding(14.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    CircularProgressIndicator(color = Teal, modifier = Modifier.size(26.dp), strokeWidth = 3.dp)
                    Spacer(Modifier.height(8.dp))
                    Text(status, color = Color.White, fontSize = 13.sp, textAlign = TextAlign.Center)
                }
            }

            // ── خطأ نهائي ──
            if (error.isNotBlank()) {
                Column(
                    Modifier.align(Alignment.Center).clip(RoundedCornerShape(12.dp)).background(Color(0xCC000000)).padding(14.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(error, color = Danger, fontSize = 14.sp, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(onClick = { autoRetries = 0; attempt += 1 }) { Text("إعادة المحاولة") }
                        TextButton(onClick = onExit) { Text("رجوع", color = Color.White) }
                    }
                }
            }
        }

        // ── الوضع الطولي: تفاصيل القناة ثم بقية قنوات القسم ──
        if (!isLandscape) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp)) {
                Text(current.name, color = TextMain, fontWeight = FontWeight.Bold, fontSize = 19.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    KindBadge(current, playback?.onDemand == true)
                    Spacer(Modifier.width(8.dp))
                    Text("الجودة: $qualityLabel", color = TextDim, fontSize = 13.sp)
                    if (current.categoryName.isNotBlank()) {
                        Text("  •  ${current.categoryName}", color = TextDim, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Spacer(Modifier.weight(1f))
                    QualityButton(levels, manualIndex, qualityMenu, { qualityMenu = it }, onAuto, onPick)
                }
                Spacer(Modifier.height(4.dp))
                Text("اقلب الجوال لملء الشاشة", color = TextDim, fontSize = 12.sp)
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(Surface2))
            if (playlist.size > 1) {
                Text(
                    "قنوات أخرى", color = TextMain, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                    modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 4.dp),
                )
                LazyColumn(
                    Modifier.fillMaxWidth().weight(1f),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    items(playlist, key = { it.id }) { ch ->
                        PlaylistRow(ch, selected = ch.id == current.id) { if (ch.id != current.id) current = ch }
                    }
                }
            }
        }
    }
}

private fun fitLabel(m: Int): String = when (m) {
    0 -> "ملاءمة"
    2 -> "تمديد"
    else -> "ملء الشاشة"
}

private fun kindLabel(ch: Channel, onDemand: Boolean): String =
    if (ch.isVod) "فيلم" else if (onDemand) "بث عند الطلب" else "بث مباشر"

@Composable
private fun KindBadge(ch: Channel, onDemand: Boolean) {
    val live = !ch.isVod && !onDemand
    Row(
        Modifier.clip(RoundedCornerShape(6.dp)).background(if (live) LiveRed else TealDark).padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (live) {
            Box(Modifier.size(6.dp).clip(RoundedCornerShape(3.dp)).background(Color.White))
            Spacer(Modifier.width(5.dp))
        }
        Text(kindLabel(ch, onDemand), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun QualityButton(
    levels: List<QualityLevel>,
    manualIndex: Int,
    open: Boolean,
    setOpen: (Boolean) -> Unit,
    onAuto: () -> Unit,
    onPick: (Int) -> Unit,
) {
    if (levels.size <= 1) return
    Box {
        TextButton(onClick = { setOpen(true) }) {
            Text(
                if (manualIndex == -1) "الجودة: تلقائي" else "الجودة: ${levels.firstOrNull { it.index == manualIndex }?.label ?: ""}",
                color = Teal, fontWeight = FontWeight.Bold,
            )
        }
        DropdownMenu(expanded = open, onDismissRequest = { setOpen(false) }) {
            DropdownMenuItem(
                text = { Text(if (manualIndex == -1) "✓ تلقائي (يُنصح به)" else "تلقائي (يُنصح به)") },
                onClick = { setOpen(false); onAuto() },
            )
            levels.forEach { lvl ->
                DropdownMenuItem(
                    text = { Text((if (manualIndex == lvl.index) "✓ " else "") + lvl.label) },
                    onClick = { setOpen(false); onPick(lvl.index) },
                )
            }
        }
    }
}

@Composable
private fun PlaylistRow(ch: Channel, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) Surface2 else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.width(104.dp).aspectRatio(16f / 10f).clip(RoundedCornerShape(8.dp)).background(Color(0xFF0E1526)),
            contentAlignment = Alignment.Center,
        ) {
            val img = Api.imageUrl(ch.logoUrl)
            if (img != null) {
                AsyncImage(
                    model = img, contentDescription = null,
                    contentScale = if (ch.isVod) ContentScale.Crop else ContentScale.Fit,
                    modifier = Modifier.fillMaxSize().padding(if (ch.isVod) 0.dp else 6.dp),
                )
            } else {
                Text(ch.name.take(1), color = Teal, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(ch.name, color = TextMain, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(2.dp))
            Text(
                if (selected) "▶ يُعرض الآن" else if (ch.isVod) "فيلم" else if (ch.onDemand) "عند الطلب" else "بث مباشر",
                color = if (selected) Teal else TextDim, fontSize = 12.sp,
            )
        }
    }
}
