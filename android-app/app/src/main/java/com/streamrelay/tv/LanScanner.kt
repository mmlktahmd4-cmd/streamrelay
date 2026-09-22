package com.streamrelay.tv

import android.content.Context
import android.net.ConnectivityManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONObject
import java.net.Inet4Address

/**
 * البحث التلقائي عن سيرفر StreamRelay في شبكة الواي-فاي الحالية:
 * يفحص /api/health على كل عنوان في شبكة الجهاز (/24) على المنفذين 80 و8080.
 */
object LanScanner {
    data class Found(val origin: String, val title: String)

    /** عنوان IPv4 الحالي للجهاز (واي-فاي أو إيثرنت) */
    fun localIpv4(context: Context): String? {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return null
        val network = cm.activeNetwork ?: return null
        val lp = cm.getLinkProperties(network) ?: return null
        return lp.linkAddresses
            .map { it.address }
            .firstOrNull { it is Inet4Address && !it.isLoopbackAddress }
            ?.hostAddress
    }

    /** بوابة الشبكة الافتراضية (غالباً هي الراوتر — وقد يكون السيرفر بجانبه) */
    private fun gateway(context: Context): String? {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return null
        val network = cm.activeNetwork ?: return null
        val lp = cm.getLinkProperties(network) ?: return null
        return lp.routes
            .firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }
            ?.gateway?.hostAddress
    }

    suspend fun scan(context: Context, onProgress: (Int, Int) -> Unit = { _, _ -> }): List<Found> {
        val ip = localIpv4(context) ?: return emptyList()
        val parts = ip.split('.')
        if (parts.size != 4) return emptyList()
        val prefix = parts.take(3).joinToString(".")
        val gw = gateway(context)

        val hosts = LinkedHashSet<String>()
        if (gw != null) hosts.add(gw)
        for (i in 1..254) hosts.add("$prefix.$i")
        hosts.remove(ip)

        val total = hosts.size * 2
        var done = 0
        val sem = Semaphore(48)
        return withContext(Dispatchers.IO) {
            coroutineScope {
                hosts.flatMap { h -> listOf("http://$h", "http://$h:8080") }
                    .map { origin ->
                        async {
                            sem.withPermit {
                                val r = probe(origin)
                                synchronized(this@LanScanner) { done += 1 }
                                onProgress(done, total)
                                r
                            }
                        }
                    }
                    .awaitAll()
                    .filterNotNull()
            }
        }
    }

    private fun probe(origin: String): Found? {
        return try {
            val req = Request.Builder().url("$origin/api/health").get().build()
            Api.probeClient.newCall(req).execute().use { r ->
                if (r.code != 200) return null
                val j = JSONObject(r.body?.string() ?: return null)
                if (!j.str("service").contains("streamrelay")) return null
            }
            val title = try {
                Api.probeClient.newCall(Request.Builder().url("$origin/api/branding").get().build())
                    .execute().use { r -> JSONObject(r.body?.string() ?: "{}").str("app_title") }
            } catch (_: Exception) { "" }
            Found(origin, title.ifBlank { "StreamRelay" })
        } catch (_: Exception) {
            null
        }
    }
}
