package com.streamrelay.tv.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.streamrelay.tv.Api
import com.streamrelay.tv.ApiException
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(initialMessage: String, onLoggedIn: () -> Unit, onChangeServer: () -> Unit) {
    val scope = rememberCoroutineScope()
    val prefs = Api.prefs

    var username by remember { mutableStateOf(prefs.username) }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(initialMessage) }
    var title by remember { mutableStateOf(prefs.appTitle.ifBlank { "StreamRelay" }) }
    var tagline by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        try {
            val b = Api.branding()
            title = b.appTitle
            tagline = b.tagline
            prefs.appTitle = b.appTitle
        } catch (_: Exception) { }
    }

    fun submit() {
        if (username.isBlank() || password.isBlank()) {
            error = "يرجى إدخال اسم المستخدم وكلمة المرور"
            return
        }
        busy = true
        error = ""
        scope.launch {
            try {
                Api.login(username, password)
                onLoggedIn()
            } catch (e: ApiException) {
                error = if (e.reason == "session_replaced")
                    "تم فتح الحساب من جهاز آخر — مسموح جهاز واحد فقط"
                else e.message ?: "فشل تسجيل الدخول — تحقق من اسم المستخدم وكلمة المرور"
            } catch (_: Exception) {
                error = "تعذّر الاتصال بالسيرفر — تحقق من الشبكة أو أن الخدمة تعمل"
            } finally {
                busy = false
            }
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(48.dp))
        Text(title, fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Teal, textAlign = TextAlign.Center)
        Text(tagline.ifBlank { "ادخل بحسابك للمشاهدة" }, color = TextDim, fontSize = 14.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(30.dp))

        OutlinedTextField(
            value = username,
            onValueChange = { username = it; error = "" },
            label = { Text("اسم المستخدم") },
            singleLine = true,
            enabled = !busy,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it; error = "" },
            label = { Text("كلمة المرور") },
            singleLine = true,
            enabled = !busy,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = { submit() },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth().height(50.dp),
            shape = RoundedCornerShape(12.dp),
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
            else Text("دخول", fontSize = 17.sp, fontWeight = FontWeight.Bold)
        }

        if (error.isNotBlank()) {
            Spacer(Modifier.height(14.dp))
            Text(error, color = Danger, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }

        Spacer(Modifier.height(28.dp))
        Text("السيرفر: " + prefs.serverUrl.removePrefix("http://"), color = TextDim, fontSize = 12.sp)
        TextButton(onClick = onChangeServer, enabled = !busy) { Text("تغيير السيرفر", color = Teal) }
    }
}
