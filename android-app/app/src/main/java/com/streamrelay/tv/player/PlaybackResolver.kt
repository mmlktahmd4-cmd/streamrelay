package com.streamrelay.tv.player

import com.streamrelay.tv.Api
import com.streamrelay.tv.Playback
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.net.URI

/**
 * اللوحة تُرجع رابط التشغيل مبنياً على عنوانها المضبوط في الإعدادات (IP الشبكة المحلية
 * أو الدومين العام). التطبيق قد يكون على الشبكة نفسها أو خارجها، لذلك:
 *  - القناة على السيرفر الرئيسي (relay=false): نستبدل الأصل بعنوان السيرفر الذي يتصل به
 *    التطبيق فعلاً (نفس nginx يقدّم /api/hls و /vod) — يعمل داخل الشبكة وخارجها.
 *  - القناة على سيرفر بث بعيد (relay=true): نجرّب الرابط المباشر أولاً (أسرع، يوزّع
 *    الحمل داخل الشبكة)، وإن لم يُجب خلال ثوانٍ نمرّ عبر اللوحة الرئيسية التي تنقله.
 */
object PlaybackResolver {

    fun rewriteToOrigin(url: String, origin: String): String {
        return try {
            val u = URI(url)
            val path = u.rawPath ?: "/"
            val query = u.rawQuery
            origin.trimEnd('/') + path + (if (query.isNullOrEmpty()) "" else "?$query")
        } catch (_: Exception) {
            url
        }
    }

    private fun sameHost(url: String, origin: String): Boolean = try {
        val a = URI(url)
        val b = URI(origin)
        a.host.equals(b.host, ignoreCase = true) &&
            (if (a.port == -1) defaultPort(a.scheme) else a.port) == (if (b.port == -1) defaultPort(b.scheme) else b.port)
    } catch (_: Exception) { false }

    private fun defaultPort(scheme: String?) = if (scheme.equals("https", true)) 443 else 80

    private suspend fun reachable(url: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url(url).header("Range", "bytes=0-64").get().build()
            Api.probeClient.newBuilder()
                .connectTimeout(2500, java.util.concurrent.TimeUnit.MILLISECONDS)
                .readTimeout(3000, java.util.concurrent.TimeUnit.MILLISECONDS)
                .build()
                .newCall(req).execute().use { r -> r.code in 200..299 || r.code == 503 }
        } catch (_: Exception) {
            false
        }
    }

    suspend fun resolve(playback: Playback): String {
        val origin = Api.origin()
        val url = playback.url
        if (url.isBlank()) return url
        if (sameHost(url, origin)) return url
        if (!playback.relay) return rewriteToOrigin(url, origin)
        return if (reachable(url)) url else rewriteToOrigin(url, origin)
    }
}
