package com.streamrelay.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.streamrelay.tv.Api
import com.streamrelay.tv.LanScanner
import com.streamrelay.tv.Prefs
import kotlinx.coroutines.launch

@Composable
fun ServerScreen(onConnected: () -> Unit, canGoBack: Boolean, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val prefs = Api.prefs

    var address by remember { mutableStateOf(prefs.serverUrl) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var scanning by remember { mutableStateOf(false) }
    var scanProgress by remember { mutableStateOf(0f) }
    var found by remember { mutableStateOf<List<LanScanner.Found>>(emptyList()) }
    var scanned by remember { mutableStateOf(false) }

    fun connect(input: String) {
        val origin = Prefs.normalizeServer(input)
        if (origin == null) {
            error = "اكتب عنوان السيرفر: مثل 192.168.1.10 أو tv.example.com"
            return
        }
        busy = true
        error = ""
        scope.launch {
            try {
                val title = Api.probeServer(origin)
                prefs.serverUrl = origin
                prefs.appTitle = title
                onConnected()
            } catch (e: Exception) {
                error = when (e) {
                    is com.streamrelay.tv.ApiException -> e.message ?: "تعذّر الاتصال"
                    else -> "تعذّر الوصول إلى $origin — تأكد أنك على نفس الشبكة أو أن الدومين صحيح"
                }
            } finally {
                busy = false
            }
        }
    }

    fun scan() {
        scanning = true
        scanned = false
        found = emptyList()
        error = ""
        scope.launch {
            try {
                val ip = LanScanner.localIpv4(context)
                if (ip == null) {
                    error = "لا يوجد اتصال واي-فاي/شبكة محلية — اكتب العنوان يدوياً"
                } else {
                    found = LanScanner.scan(context) { done, total -> scanProgress = done.toFloat() / total }
                    scanned = true
                    if (found.size == 1) address = found.first().origin
                }
            } finally {
                scanning = false
            }
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(40.dp))
        Text("StreamRelay", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Teal)
        Text("الاتصال بسيرفر البث", color = TextDim, fontSize = 15.sp)
        Spacer(Modifier.height(28.dp))

        OutlinedTextField(
            value = address,
            onValueChange = { address = it; error = "" },
            label = { Text("عنوان السيرفر") },
            placeholder = { Text("192.168.1.10  أو  tv.example.com") },
            singleLine = true,
            enabled = !busy,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        Button(
            onClick = { connect(address) },
            enabled = !busy && !scanning,
            modifier = Modifier.fillMaxWidth().height(50.dp),
            shape = RoundedCornerShape(12.dp),
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = androidx.compose.ui.graphics.Color.White, strokeWidth = 2.dp)
            else Text("اتصال", fontSize = 17.sp, fontWeight = FontWeight.Bold)
        }

        Spacer(Modifier.height(10.dp))
        OutlinedButton(
            onClick = { scan() },
            enabled = !busy && !scanning,
            modifier = Modifier.fillMaxWidth().height(50.dp),
            shape = RoundedCornerShape(12.dp),
        ) {
            Text(if (scanning) "جاري البحث في الشبكة…" else "بحث تلقائي في الشبكة المحلية", fontSize = 15.sp)
        }
        if (scanning) {
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(progress = { scanProgress }, modifier = Modifier.fillMaxWidth())
        }

        if (error.isNotBlank()) {
            Spacer(Modifier.height(12.dp))
            Text(error, color = Danger, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }

        if (scanned) {
            Spacer(Modifier.height(16.dp))
            if (found.isEmpty()) {
                Text("لم يُعثر على سيرفر في هذه الشبكة — اكتب العنوان يدوياً", color = TextDim, textAlign = TextAlign.Center)
            } else {
                Text("السيرفرات الموجودة:", color = TextMain, fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(6.dp))
                found.forEach { f ->
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 4.dp)
                            .clip(RoundedCornerShape(10.dp)).background(Surface2)
                            .clickable(enabled = !busy) { address = f.origin; connect(f.origin) }
                            .padding(14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(f.title, color = TextMain, fontWeight = FontWeight.Bold)
                        Text(f.origin.removePrefix("http://"), color = Teal)
                    }
                }
            }
        }

        Spacer(Modifier.height(28.dp))
        Text(
            "داخل الشبكة: اكتب IP السيرفر (مثل 192.168.1.10 أو مع المنفذ 192.168.1.10:8080).\n" +
                "من خارج الشبكة: اكتب الدومين العام (مثل tv.example.com) إن كانت اللوحة منشورة على الإنترنت.",
            color = TextDim, fontSize = 13.sp, textAlign = TextAlign.Center, lineHeight = 20.sp,
        )

        if (canGoBack) {
            Spacer(Modifier.height(12.dp))
            TextButton(onClick = onBack) { Text("رجوع", color = Teal) }
        }
    }
}
