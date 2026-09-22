package com.streamrelay.tv.player

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.AdaptiveTrackSelection
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.upstream.DefaultBandwidthMeter
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy

/**
 * مشغّل مضبوط على «معمارية يوتيوب»:
 *  - تقدير سرعة ابتدائي منخفض (250 kbps) → أول مقطع يُطلب من أدنى جودة (144p) فتظهر
 *    الصورة خلال ثانية حتى على إشارة ضعيفة، ثم يرتفع تلقائياً بعد قياس السرعة الحقيقية.
 *  - رفع الجودة بتحفّظ (0.65 من السرعة المقاسة، بعد 5ث مخزن) وخفضها بسرعة.
 *  - البدء بعد ثانية واحدة من المخزن، وتراكم حتى 60ث لامتصاص انقطاعات الواي-فاي.
 */
data class QualityLevel(val index: Int, val height: Int, val bitrate: Int) {
    val label: String get() = if (height > 0) "${height}p" else "${bitrate / 1000}k"
}

object PlayerFactory {

    const val LIVE_TARGET_OFFSET_MS = 20_000L

    @OptIn(UnstableApi::class)
    fun create(context: Context): ExoPlayer {
        val bandwidthMeter = DefaultBandwidthMeter.Builder(context)
            .setInitialBitrateEstimate(250_000L)
            .setResetOnNetworkTypeChange(true)
            .build()

        val adaptiveFactory = AdaptiveTrackSelection.Factory(
            /* minDurationForQualityIncreaseMs = */ 5_000,
            /* maxDurationForQualityDecreaseMs = */ 8_000,
            /* minDurationToRetainAfterDiscardMs = */ 8_000,
            /* bandwidthFraction = */ 0.65f,
        )
        val trackSelector = DefaultTrackSelector(context, adaptiveFactory)

        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                /* minBufferMs = */ 20_000,
                /* maxBufferMs = */ 60_000,
                /* bufferForPlaybackMs = */ 1_000,
                /* bufferForPlaybackAfterRebufferMs = */ 2_500,
            )
            .setBackBuffer(15_000, false)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build()

        val httpFactory = DefaultHttpDataSource.Factory()
            .setUserAgent("StreamRelayTV/2.0 (Android)")
            .setConnectTimeoutMs(8_000)
            .setReadTimeoutMs(12_000)
            .setAllowCrossProtocolRedirects(true)
        val dataSourceFactory = DefaultDataSource.Factory(context, httpFactory)

        val mediaSourceFactory = DefaultMediaSourceFactory(context)
            .setDataSourceFactory(dataSourceFactory)
            // محاولات أكثر قبل إعلان الفشل — القوائم قد ترجع 503 لحظياً أثناء إقلاع قناة On Demand
            .setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(/* minimumLoadableRetryCount = */ 6))

        return ExoPlayer.Builder(context)
            .setBandwidthMeter(bandwidthMeter)
            .setTrackSelector(trackSelector)
            .setLoadControl(loadControl)
            .setMediaSourceFactory(mediaSourceFactory)
            .build()
    }

    fun mediaItem(url: String, live: Boolean): MediaItem {
        val b = MediaItem.Builder().setUri(url)
        if (live) {
            b.setMimeType(MimeTypes.APPLICATION_M3U8)
            // نبدأ 20ث خلف الحافة الحية: مخزن مريح (10 مقاطع × 2ث) دون تسريع/إبطاء التشغيل
            b.setLiveConfiguration(
                MediaItem.LiveConfiguration.Builder()
                    .setTargetOffsetMs(LIVE_TARGET_OFFSET_MS)
                    .setMinPlaybackSpeed(1f)
                    .setMaxPlaybackSpeed(1f)
                    .build()
            )
        }
        return b.build()
    }

    /** درجات الجودة المتاحة في البث الحالي (مرتّبة من الأعلى إلى الأدنى) */
    fun qualityLevels(tracks: Tracks): Pair<Tracks.Group?, List<QualityLevel>> {
        val group = tracks.groups
            .filter { it.type == C.TRACK_TYPE_VIDEO && it.length > 0 }
            .maxByOrNull { it.length } ?: return null to emptyList()
        val levels = (0 until group.length)
            .filter { group.isTrackSupported(it) }
            .map { i ->
                val f = group.getTrackFormat(i)
                QualityLevel(i, f.height, f.bitrate)
            }
            .sortedByDescending { if (it.height > 0) it.height else it.bitrate }
        return group to levels
    }

    fun selectQuality(player: ExoPlayer, group: Tracks.Group, index: Int) {
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, index))
            .build()
    }

    fun selectAuto(player: ExoPlayer) {
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
            .build()
    }
}
