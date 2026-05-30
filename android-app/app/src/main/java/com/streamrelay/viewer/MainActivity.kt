package com.streamrelay.viewer

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ActivityInfo
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import androidx.appcompat.app.AppCompatActivity

/** يعرض بوابة المشاهدة داخل WebView مع دعم تشغيل الفيديو وملء الشاشة. */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var progress: ProgressBar
    private lateinit var fullscreenContainer: FrameLayout

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val watchUrl = ServerPrefs.watchUrl(this)
        if (watchUrl == null) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }

        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webView)
        progress = findViewById(R.id.progress)
        fullscreenContainer = findViewById(R.id.fullscreenContainer)

        configureWebView()

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(watchUrl)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.addJavascriptInterface(JsBridge(), "StreamRelay")

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = true
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            userAgentString = "$userAgentString StreamRelayApp/1.0"
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return false
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                progress.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                progress.visibility = View.GONE
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                if (request.isForMainFrame) {
                    progress.visibility = View.GONE
                    view.loadDataWithBaseURL(null, errorPage(), "text/html", "UTF-8", null)
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progress.progress = newProgress
                progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
            }

            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customView != null) {
                    callback.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                fullscreenContainer.addView(view)
                fullscreenContainer.visibility = View.VISIBLE
                webView.visibility = View.GONE
                enterFullscreen()
            }

            override fun onHideCustomView() {
                if (customView == null) return
                fullscreenContainer.removeAllViews()
                fullscreenContainer.visibility = View.GONE
                webView.visibility = View.VISIBLE
                customView = null
                customViewCallback?.onCustomViewHidden()
                customViewCallback = null
                exitFullscreen()
            }
        }
    }

    private fun enterFullscreen() {
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
        supportActionBar?.hide()
    }

    private fun exitFullscreen() {
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
        supportActionBar?.show()
    }

    private fun errorPage(): String {
        val server = ServerPrefs.raw(this) ?: ""
        return """
            <html dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{background:#0f172a;color:#e2e8f0;font-family:sans-serif;text-align:center;padding:40px}
            h2{color:#14b8a6}button{background:#14b8a6;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:16px;margin:8px}</style>
            </head><body>
            <h2>تعذّر الاتصال بالسيرفر</h2>
            <p>تأكّد أن الجهاز على نفس الشبكة وأن العنوان صحيح:</p>
            <p><b>$server</b></p>
            <button onclick="location.reload()">إعادة المحاولة</button>
            <button onclick="StreamRelay.openSetup()">تغيير العنوان</button>
            </body></html>
        """.trimIndent()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            R.id.action_refresh -> {
                webView.reload()
                true
            }
            R.id.action_server -> {
                openSetup()
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    private fun openSetup() {
        startActivity(
            Intent(this, SetupActivity::class.java).putExtra(SetupActivity.EXTRA_EDITING, true)
        )
        finish()
    }

    /** جسر JS — تستدعيه صفحة الخطأ لتغيير العنوان. */
    inner class JsBridge {
        @android.webkit.JavascriptInterface
        fun openSetup() {
            runOnUiThread { this@MainActivity.openSetup() }
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        when {
            customView != null -> (webView.webChromeClient as? WebChromeClient)?.onHideCustomView()
            webView.canGoBack() -> webView.goBack()
            else -> super.onBackPressed()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }
}
