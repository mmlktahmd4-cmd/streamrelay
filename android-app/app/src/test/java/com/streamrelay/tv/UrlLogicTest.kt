package com.streamrelay.tv

import com.streamrelay.tv.player.PlaybackResolver
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * اختبارات المنطق الذي يجعل التطبيق يعمل داخل الشبكة وخارجها:
 * تطبيع عنوان السيرفر، وإعادة كتابة روابط التشغيل على أصل التطبيق.
 */
class UrlLogicTest {

    @Test
    fun normalizesEveryWayAClientTypesTheAddress() {
        assertEquals("http://192.168.1.10", Prefs.normalizeServer("192.168.1.10"))
        assertEquals("http://192.168.1.10", Prefs.normalizeServer("  192.168.1.10/  "))
        assertEquals("http://192.168.1.10:8080", Prefs.normalizeServer("192.168.1.10:8080"))
        assertEquals("http://192.168.1.10", Prefs.normalizeServer("http://192.168.1.10:80/watch/login"))
        assertEquals("https://tv.example.com", Prefs.normalizeServer("https://tv.example.com/"))
        assertEquals("https://tv.example.com", Prefs.normalizeServer("https://tv.example.com:443"))
        assertEquals("https://tv.example.com:8443", Prefs.normalizeServer("https://tv.example.com:8443/x"))
        assertEquals("http://tv.example.com", Prefs.normalizeServer("tv.example.com"))
        assertNull(Prefs.normalizeServer(""))
        assertNull(Prefs.normalizeServer("   "))
    }

    @Test
    fun rewritesPanelUrlToTheOriginTheAppActuallyUses() {
        val signed = "http://10.0.0.5/api/hls/abc-123/index.m3u8?expires=1790000000&sig=deadbeef"
        assertEquals(
            "http://192.168.1.10/api/hls/abc-123/index.m3u8?expires=1790000000&sig=deadbeef",
            PlaybackResolver.rewriteToOrigin(signed, "http://192.168.1.10"),
        )
        // دومين عام مضبوط في اللوحة بينما التطبيق على الشبكة المحلية
        assertEquals(
            "http://192.168.1.10:8080/vod/movie-1.mp4",
            PlaybackResolver.rewriteToOrigin("https://tv.example.com/vod/movie-1.mp4", "http://192.168.1.10:8080/"),
        )
        // IP محلي في اللوحة بينما التطبيق خارج الشبكة عبر الدومين
        assertEquals(
            "https://tv.example.com/api/hls/x/index.m3u8?expires=1&sig=2",
            PlaybackResolver.rewriteToOrigin("http://192.168.1.10/api/hls/x/index.m3u8?expires=1&sig=2", "https://tv.example.com"),
        )
        // رابط غير صالح يُعاد كما هو بدل الانهيار
        assertEquals("not a url", PlaybackResolver.rewriteToOrigin("not a url", "http://192.168.1.10"))
    }

    @Test
    fun jsonHelpersTreatNullAsEmpty() {
        val o = org.json.JSONObject("{\"a\":null,\"b\":\"x\",\"c\":true}")
        assertEquals("", o.str("a"))
        assertEquals("", o.str("missing"))
        assertEquals("x", o.str("b"))
        assertEquals(true, o.bool("c"))
        assertEquals(true, o.bool("a", true))
    }
}
