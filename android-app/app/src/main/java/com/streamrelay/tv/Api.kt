package com.streamrelay.tv

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class ApiException(val code: Int, message: String, val reason: String = "") : Exception(message)

/* ───────────── نماذج البيانات (كما يُرجعها API اللوحة) ───────────── */

fun JSONObject.str(key: String): String = if (isNull(key)) "" else optString(key, "")
fun JSONObject.bool(key: String, def: Boolean = false): Boolean = if (isNull(key)) def else optBoolean(key, def)

data class Channel(
    val id: String,
    val name: String,
    val slug: String,
    val logoUrl: String,
    val categoryId: String,
    val categoryName: String,
    val status: String,
    val onDemand: Boolean,
    val contentType: String, // live | vod
    val description: String,
    val sortOrder: Int,
) {
    val isVod: Boolean get() = contentType == "vod"
    /** قابلة للتشغيل: فيديو، أو قناة عند الطلب، أو قناة مباشرة تعمل الآن */
    val playable: Boolean get() = isVod || onDemand || status == "running"

    companion object {
        fun from(o: JSONObject) = Channel(
            id = o.str("id"),
            name = o.str("name"),
            slug = o.str("slug"),
            logoUrl = o.str("logo_url").ifBlank { o.str("poster_url") },
            categoryId = o.str("category_id"),
            categoryName = o.str("category_name"),
            status = o.str("status"),
            onDemand = o.bool("on_demand"),
            contentType = o.str("content_type").ifBlank { "live" },
            description = o.str("description"),
            sortOrder = o.optInt("sort_order", 0),
        )
    }
}

data class Category(val id: String, val name: String, val sectionType: String, val sortOrder: Int) {
    companion object {
        fun from(o: JSONObject) = Category(
            id = o.str("id"),
            name = o.str("name"),
            sectionType = o.str("section_type").ifBlank { "mixed" },
            sortOrder = o.optInt("sort_order", 0),
        )
    }
}

data class Branding(val appTitle: String, val tagline: String, val liveNotice: String, val vodNotice: String)

data class Playback(
    val url: String,
    val type: String,      // live | vod
    val relay: Boolean,    // القناة على سيرفر بث بعيد (الرابط لسيرفر آخر)
    val onDemand: Boolean,
    val starting: Boolean,
    val status: String,
    val note: String,
)

/** كاش في الذاكرة لقائمة القنوات/الأقسام — الرئيسية تُعرض فوراً عند الرجوع من المشغّل ثم تتحدّث */
object HomeCache {
    @Volatile var channels: List<Channel> = emptyList()
    @Volatile var categories: List<Category> = emptyList()
}

/* ───────────── عميل API ───────────── */

object Api {
    lateinit var prefs: Prefs

    /** يُستدعى عند فقدان الجلسة نهائياً (دخول من جهاز آخر / انتهاء الحساب) */
    @Volatile var onSessionLost: ((String) -> Unit)? = null

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    /** عميل سريع الفشل لفحص السيرفرات/الروابط (بحث الشبكة، اختبار الرابط المباشر) */
    val probeClient: OkHttpClient = client.newBuilder()
        .connectTimeout(700, TimeUnit.MILLISECONDS)
        .readTimeout(1500, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(false)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val refreshLock = Any()

    fun origin(): String = prefs.serverUrl.trimEnd('/')
    private fun api(path: String) = origin() + "/api" + path

    /** يمرّر الصور الخارجية عبر وكيل اللوحة (كما تفعل بوابة الويب) لتفادي حظر hotlink */
    fun imageUrl(raw: String): String? {
        val u = raw.trim()
        if (u.isEmpty()) return null
        if (u.startsWith("data:")) return u
        if (u.startsWith("/")) return origin() + u
        if (u.startsWith("http://") || u.startsWith("https://")) {
            return if (u.startsWith(origin() + "/")) u
            else api("/img?u=" + URLEncoder.encode(u, "UTF-8"))
        }
        return null
    }

    /* ---------- طبقة الطلبات ---------- */

    private class Resp(val code: Int, val body: String) {
        fun json(): JSONObject = try { JSONObject(body) } catch (_: Exception) { JSONObject() }
        fun error(): String = json().str("error")
        fun reason(): String = json().str("reason")
    }

    private fun rawCall(method: String, url: String, body: JSONObject?, token: String?): Resp {
        val b = Request.Builder().url(url)
            .header("Accept", "application/json")
            .header("User-Agent", "StreamRelayTV/2.0 (Android)")
        if (!token.isNullOrBlank()) b.header("Authorization", "Bearer $token")
        when (method) {
            "GET" -> b.get()
            "POST" -> b.post((body ?: JSONObject()).toString().toRequestBody(jsonType))
            else -> throw IllegalArgumentException(method)
        }
        client.newCall(b.build()).execute().use { r ->
            return Resp(r.code, r.body?.string() ?: "")
        }
    }

    private fun refreshAccessToken(): Boolean {
        synchronized(refreshLock) {
            val rt = prefs.refreshToken
            if (rt.isBlank()) return false
            val r = rawCall("POST", api("/auth/refresh"), JSONObject().put("refresh_token", rt), null)
            if (r.code in 200..299) {
                val j = r.json()
                val at = j.str("access_token")
                if (at.isBlank()) return false
                prefs.accessToken = at
                val newRt = j.str("refresh_token")
                if (newRt.isNotBlank()) prefs.refreshToken = newRt
                return true
            }
            if (r.code == 401 || r.code == 403) {
                val reason = r.reason()
                // دخول من جهاز آخر (جهاز واحد لكل حساب) — لا نحاول الدخول بكلمة المرور
                if (reason == "session_replaced") {
                    prefs.clearSession()
                    onSessionLost?.invoke(r.error().ifBlank { "تم تسجيل الدخول من جهاز آخر — مسموح جهاز واحد فقط" })
                    return false
                }
                // انتهى التوكن (7 أيام مثلاً): نعيد الدخول تلقائياً بالحساب المحفوظ
                if (prefs.username.isNotBlank() && prefs.password.isNotBlank()) {
                    val lr = rawCall(
                        "POST", api("/auth/login"),
                        JSONObject().put("username", prefs.username).put("password", prefs.password), null
                    )
                    if (lr.code in 200..299) {
                        storeLogin(lr.json())
                        return true
                    }
                    if (lr.code == 401 || lr.code == 403) {
                        prefs.clearSession()
                        onSessionLost?.invoke(lr.error().ifBlank { "انتهت الجلسة — سجّل الدخول من جديد" })
                    }
                }
                return false
            }
            return false
        }
    }

    private suspend fun request(method: String, path: String, body: JSONObject? = null, auth: Boolean = true): String =
        withContext(Dispatchers.IO) {
            var r = rawCall(method, api(path), body, if (auth) prefs.accessToken else null)
            if (auth && r.code == 401) {
                if (refreshAccessToken()) {
                    r = rawCall(method, api(path), body, prefs.accessToken)
                }
            }
            if (r.code !in 200..299) {
                throw ApiException(r.code, r.error().ifBlank { defaultMessage(r.code) }, r.reason())
            }
            r.body
        }

    private fun defaultMessage(code: Int): String = when (code) {
        400 -> "طلب غير صالح"
        401 -> "الجلسة غير صالحة — سجّل الدخول من جديد"
        403 -> "غير مسموح"
        404 -> "غير موجود"
        409 -> "القناة متوقفة حالياً"
        429 -> "محاولات كثيرة — انتظر دقيقة ثم حاول مجدداً"
        503 -> "السيرفر مشغول — حاول بعد قليل"
        else -> "خطأ من السيرفر ($code)"
    }

    private fun storeLogin(j: JSONObject) {
        prefs.accessToken = j.str("access_token")
        prefs.refreshToken = j.str("refresh_token")
        val user = j.optJSONObject("user")
        if (user != null) {
            prefs.username = user.str("username").ifBlank { prefs.username }
            prefs.expiresAt = user.str("expires_at")
        }
    }

    /* ---------- نقاط النهاية ---------- */

    /** فحص أن العنوان سيرفر StreamRelay فعلاً — يُرجع اسم اللوحة (app_title) */
    suspend fun probeServer(originUrl: String): String = withContext(Dispatchers.IO) {
        val base = originUrl.trimEnd('/')
        val req = Request.Builder().url("$base/api/health").header("Accept", "application/json").get().build()
        client.newBuilder().connectTimeout(5, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).build()
            .newCall(req).execute().use { r ->
                if (r.code !in 200..299) throw ApiException(r.code, "العنوان لا يستجيب كسيرفر StreamRelay (${r.code})")
                val j = try { JSONObject(r.body?.string() ?: "") } catch (_: Exception) { JSONObject() }
                if (!j.str("service").contains("streamrelay")) throw ApiException(0, "العنوان يعمل لكنه ليس سيرفر StreamRelay")
            }
        // اسم اللوحة (عام بلا توكن)
        val br = Request.Builder().url("$base/api/branding").get().build()
        val title = try {
            client.newCall(br).execute().use { r -> JSONObject(r.body?.string() ?: "{}").str("app_title") }
        } catch (_: Exception) { "" }
        title.ifBlank { "StreamRelay" }
    }

    suspend fun branding(): Branding {
        val j = JSONObject(request("GET", "/branding", auth = false))
        return Branding(
            appTitle = j.str("app_title").ifBlank { "StreamRelay" },
            tagline = j.str("app_tagline"),
            liveNotice = j.str("live_watch_notice"),
            vodNotice = j.str("vod_watch_notice"),
        )
    }

    /** دخول مشاهد — يرفض حسابات الإدارة كما تفعل بوابة الويب */
    suspend fun login(username: String, password: String) {
        val body = JSONObject().put("username", username.trim()).put("password", password)
        val j = JSONObject(request("POST", "/auth/login", body, auth = false))
        val role = j.optJSONObject("user")?.str("role") ?: ""
        if (role.isNotBlank() && role != "viewer") {
            throw ApiException(403, "هذا الحساب للإدارة — استخدم حساب مشاهد")
        }
        prefs.username = username.trim()
        prefs.password = password
        storeLogin(j)
    }

    suspend fun me(): JSONObject = JSONObject(request("GET", "/auth/me"))

    suspend fun presence() { request("POST", "/auth/presence") }

    suspend fun categories(): List<Category> {
        val arr = JSONArray(request("GET", "/categories"))
        return (0 until arr.length()).map { Category.from(arr.getJSONObject(it)) }
    }

    suspend fun channels(search: String = ""): List<Channel> {
        val q = if (search.isBlank()) "" else "&search=" + URLEncoder.encode(search.trim(), "UTF-8")
        val j = JSONObject(request("GET", "/channels?limit=500$q"))
        val arr = j.optJSONArray("channels") ?: JSONArray()
        return (0 until arr.length())
            .map { arr.getJSONObject(it) }
            .filter { it.bool("is_public", true) }
            .map { Channel.from(it) }
    }

    suspend fun playbackUrl(channelId: String): Playback {
        val j = JSONObject(request("GET", "/channels/$channelId/playback-url"))
        return Playback(
            url = j.str("url"),
            type = j.str("type").ifBlank { "live" },
            relay = j.bool("relay"),
            onDemand = j.bool("on_demand"),
            starting = j.bool("starting"),
            status = j.str("status"),
            note = j.str("note"),
        )
    }

    /** نبضة مشاهدة — تُبقي قناة On Demand شغّالة ما دام التطبيق يعرضها */
    suspend fun pulse(channelId: String) { request("POST", "/channels/$channelId/pulse") }

    fun logout() {
        prefs.clearSession()
        prefs.password = ""
    }
}
