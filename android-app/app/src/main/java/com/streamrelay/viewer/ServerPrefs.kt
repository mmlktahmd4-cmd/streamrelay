package com.streamrelay.viewer

import android.content.Context

/** يخزّن عنوان السيرفر الذي يدخله المستخدم ويبني منه رابط بوابة المشاهدة. */
object ServerPrefs {
    private const val PREF = "streamrelay"
    private const val KEY = "server"

    fun raw(ctx: Context): String? =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString(KEY, null)

    fun save(ctx: Context, value: String) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY, value.trim())
            .apply()
    }

    /** يطبّع المدخل إلى رابط كامل: يضيف http:// إن لزم ويزيل الشرطة الأخيرة. */
    fun baseUrl(ctx: Context): String? {
        var v = raw(ctx)?.trim() ?: return null
        if (v.isEmpty()) return null
        v = v.trimEnd('/')
        if (!v.startsWith("http://", true) && !v.startsWith("https://", true)) {
            v = "http://$v"
        }
        return v
    }

    fun watchUrl(ctx: Context): String? = baseUrl(ctx)?.let { "$it/watch/login" }
}
