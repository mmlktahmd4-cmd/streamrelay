package com.streamrelay.viewer

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import androidx.appcompat.app.AppCompatActivity

/**
 * شاشة الإعداد الأولى — يُدخل المستخدم عنوان السيرفر (IP أو دومين مع المنفذ).
 * عند فتح التطبيق لاحقاً وكان العنوان محفوظاً، ننتقل مباشرةً لشاشة المشاهدة.
 */
class SetupActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val editing = intent.getBooleanExtra(EXTRA_EDITING, false)
        if (!editing && ServerPrefs.baseUrl(this) != null) {
            openMain()
            finish()
            return
        }

        setContentView(R.layout.activity_setup)

        val input = findViewById<EditText>(R.id.serverInput)
        input.setText(ServerPrefs.raw(this) ?: "")

        findViewById<Button>(R.id.connectButton).setOnClickListener {
            val value = input.text.toString().trim()
            if (value.isEmpty()) {
                input.error = getString(R.string.setup_required)
                return@setOnClickListener
            }
            ServerPrefs.save(this, value)
            openMain()
            finish()
        }
    }

    private fun openMain() {
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        )
    }

    companion object {
        const val EXTRA_EDITING = "editing"
    }
}
