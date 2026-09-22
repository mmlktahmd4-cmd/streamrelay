package com.streamrelay.tv

import android.content.Context
import android.content.SharedPreferences

/**
 * تخزين محلي بسيط: عنوان السيرفر + جلسة الدخول.
 * عنوان السيرفر يُحفظ كأصل (origin) مُطبَّع: http://192.168.1.10 أو https://tv.example.com:8443
 */
class Prefs(context: Context) {
    private val sp: SharedPreferences =
        context.applicationContext.getSharedPreferences("streamrelay_tv", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = sp.getString("server_url", "") ?: ""
        set(v) = sp.edit().putString("server_url", v).apply()

    var accessToken: String
        get() = sp.getString("access_token", "") ?: ""
        set(v) = sp.edit().putString("access_token", v).apply()

    var refreshToken: String
        get() = sp.getString("refresh_token", "") ?: ""
        set(v) = sp.edit().putString("refresh_token", v).apply()

    var username: String
        get() = sp.getString("username", "") ?: ""
        set(v) = sp.edit().putString("username", v).apply()

    /** يُحفظ لإعادة الدخول تلقائياً عند انتهاء التوكن (7 أيام) دون إزعاج العميل. */
    var password: String
        get() = sp.getString("password", "") ?: ""
        set(v) = sp.edit().putString("password", v).apply()

    var expiresAt: String
        get() = sp.getString("expires_at", "") ?: ""
        set(v) = sp.edit().putString("expires_at", v).apply()

    var appTitle: String
        get() = sp.getString("app_title", "") ?: ""
        set(v) = sp.edit().putString("app_title", v).apply()

    /** آخر قسم اختاره المستخدم — يُستعاد عند فتح التطبيق. */
    var lastCategoryId: String
        get() = sp.getString("last_category", "") ?: ""
        set(v) = sp.edit().putString("last_category", v).apply()

    val isLoggedIn: Boolean get() = accessToken.isNotBlank() && refreshToken.isNotBlank()

    fun clearSession() {
        sp.edit()
            .remove("access_token").remove("refresh_token")
            .remove("expires_at")
            .apply()
    }

    companion object {
        /**
         * يقبل ما يكتبه العميل بأي شكل: "192.168.1.10" أو "192.168.1.10:8080" أو
         * "http://192.168.1.10/watch/login" أو "https://tv.example.com" ويُرجع الأصل فقط.
         */
        fun normalizeServer(input: String): String? {
            var s = input.trim()
            if (s.isEmpty()) return null
            if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://$s"
            return try {
                val u = java.net.URI(s)
                val host = u.host ?: return null
                val scheme = u.scheme ?: "http"
                val port = u.port
                val defaultPort = if (scheme == "https") 443 else 80
                if (port == -1 || port == defaultPort) "$scheme://$host" else "$scheme://$host:$port"
            } catch (_: Exception) {
                null
            }
        }
    }
}
