package com.streamrelay.tv.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.streamrelay.tv.Api
import com.streamrelay.tv.Category
import com.streamrelay.tv.Channel
import com.streamrelay.tv.HomeCache
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import java.time.Duration
import java.time.Instant

private const val ALL = ""

@Composable
fun HomeScreen(
    onPlay: (Channel, List<Channel>) -> Unit,
    onChangeServer: () -> Unit,
    onLogout: () -> Unit,
) {
    val context = LocalContext.current
    val prefs = Api.prefs

    var channels by remember { mutableStateOf(HomeCache.channels) }
    var categories by remember { mutableStateOf(HomeCache.categories) }
    var loading by remember { mutableStateOf(HomeCache.channels.isEmpty()) }
    var error by remember { mutableStateOf("") }
    var refreshKey by remember { mutableIntStateOf(0) }
    var activeCategory by remember { mutableStateOf(prefs.lastCategoryId) }
    var searchOpen by remember { mutableStateOf(false) }
    var search by remember { mutableStateOf("") }
    var menuOpen by remember { mutableStateOf(false) }
    val title = prefs.appTitle.ifBlank { "StreamRelay" }

    // تحميل أولي + تحديث تلقائي كل 60ث (حالة القنوات تتغيّر)
    LaunchedEffect(refreshKey) {
        var first = true
        while (isActive) {
            try {
                coroutineScope {
                    val cats = async { runCatching { Api.categories() }.getOrDefault(emptyList()) }
                    val chs = async { Api.channels() }
                    val list = chs.await()
                    categories = cats.await().sortedWith(compareBy({ it.sortOrder }, { it.name }))
                    channels = list
                    HomeCache.channels = list
                    HomeCache.categories = categories
                    error = ""
                }
            } catch (e: Exception) {
                if (channels.isEmpty()) error = e.message ?: "تعذّر تحميل القنوات"
            } finally {
                loading = false
            }
            if (first) {
                first = false
                // لو كان القسم المحفوظ لم يعد موجوداً نرجع لـ«الكل»
                if (activeCategory != ALL && channels.none { it.categoryId == activeCategory }) {
                    activeCategory = ALL
                }
            }
            delay(60_000)
        }
    }

    val visibleCategories = remember(categories, channels) {
        val used = channels.map { it.categoryId }.toSet()
        categories.filter { it.id in used }
    }
    val filtered = remember(channels, activeCategory, search) {
        val q = search.trim().lowercase()
        channels
            .filter { activeCategory == ALL || it.categoryId == activeCategory }
            .filter { q.isEmpty() || it.name.lowercase().contains(q) }
            .sortedWith(compareBy({ it.isVod }, { it.sortOrder }, { it.name }))
    }
    val liveItems = filtered.filter { !it.isVod }
    val vodItems = filtered.filter { it.isVod }

    Column(Modifier.fillMaxSize().background(Bg).statusBarsPadding()) {
        // ── الرأس ──
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (searchOpen) {
                OutlinedTextField(
                    value = search,
                    onValueChange = { search = it },
                    placeholder = { Text("ابحث عن قناة أو فيلم") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = { searchOpen = false; search = "" }) {
                    Icon(Icons.Default.Close, contentDescription = "إغلاق", tint = TextMain)
                }
            } else {
                Text(
                    title, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Teal,
                    modifier = Modifier.weight(1f).padding(start = 8.dp),
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                IconButton(onClick = { searchOpen = true }) {
                    Icon(Icons.Default.Search, contentDescription = "بحث", tint = TextMain)
                }
                IconButton(onClick = { loading = true; refreshKey += 1 }) {
                    Icon(Icons.Default.Refresh, contentDescription = "تحديث", tint = TextMain)
                }
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "القائمة", tint = TextMain)
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text(prefs.username.ifBlank { "الحساب" }, color = TextDim) },
                            onClick = { menuOpen = false }, enabled = false,
                        )
                        DropdownMenuItem(text = { Text("تغيير السيرفر") }, onClick = { menuOpen = false; onChangeServer() })
                        DropdownMenuItem(text = { Text("تسجيل الخروج", color = Danger) }, onClick = { menuOpen = false; onLogout() })
                    }
                }
            }
        }

        ExpiryBanner(prefs.expiresAt)

        // ── الأقسام ──
        if (visibleCategories.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 10.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CategoryChip("الكل", activeCategory == ALL) { activeCategory = ALL; prefs.lastCategoryId = ALL }
                visibleCategories.forEach { c ->
                    CategoryChip(c.name, activeCategory == c.id) { activeCategory = c.id; prefs.lastCategoryId = c.id }
                }
            }
        }

        // ── المحتوى ──
        when {
            loading && channels.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Teal)
            }
            error.isNotBlank() && channels.isEmpty() -> Column(
                Modifier.fillMaxSize().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(error, color = Danger, textAlign = TextAlign.Center)
                Spacer(Modifier.height(12.dp))
                TextButton(onClick = { loading = true; refreshKey += 1 }) { Text("إعادة المحاولة", color = Teal) }
            }
            filtered.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(if (search.isNotBlank()) "لا نتائج" else "لا توجد قنوات متاحة حالياً", color = TextDim)
            }
            else -> LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 108.dp),
                contentPadding = PaddingValues(10.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                if (liveItems.isNotEmpty() && vodItems.isNotEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) { SectionTitle("القنوات") }
                }
                items(liveItems, key = { it.id }) { ch ->
                    ChannelCard(ch) {
                        if (ch.playable) onPlay(ch, liveItems.filter { it.playable })
                        else Toast.makeText(context, "القناة متوقفة حالياً", Toast.LENGTH_SHORT).show()
                    }
                }
                if (vodItems.isNotEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) { SectionTitle("الأفلام والفيديو") }
                    items(vodItems, key = { it.id }) { ch ->
                        ChannelCard(ch) { onPlay(ch, vodItems) }
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, color = TextDim, fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp, bottom = 2.dp))
}

@Composable
private fun CategoryChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(if (selected) Teal else Surface2)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 7.dp),
    ) {
        Text(label, color = if (selected) Color.White else TextMain, fontSize = 13.sp, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal)
    }
}

@Composable
private fun ChannelCard(ch: Channel, onClick: () -> Unit) {
    val dim = !ch.playable
    Column(
        Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Surface1)
            .border(1.dp, Surface2, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .alpha(if (dim) 0.45f else 1f),
    ) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 10f).background(Color(0xFF0E1526)), contentAlignment = Alignment.Center) {
            val img = Api.imageUrl(ch.logoUrl)
            if (img != null) {
                AsyncImage(
                    model = img,
                    contentDescription = ch.name,
                    contentScale = if (ch.isVod) ContentScale.Crop else ContentScale.Fit,
                    modifier = Modifier.fillMaxSize().padding(if (ch.isVod) 0.dp else 8.dp),
                )
            } else {
                Text(ch.name.take(1), color = Teal, fontSize = 26.sp, fontWeight = FontWeight.Bold)
            }
            if (!dim) {
                Box(
                    Modifier.align(Alignment.BottomEnd).padding(6.dp).size(22.dp).clip(CircleShape).background(Color(0xAA000000)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Default.PlayArrow, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                }
            }
            val tag = when {
                dim -> "متوقفة"
                ch.isVod -> "فيلم"
                ch.onDemand -> "عند الطلب"
                else -> ""
            }
            if (tag.isNotEmpty()) {
                Text(
                    tag, color = Color.White, fontSize = 10.sp,
                    modifier = Modifier.align(Alignment.TopStart).padding(6.dp)
                        .clip(RoundedCornerShape(6.dp)).background(if (dim) Color(0xAA334155) else Color(0xCC0D9488))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
        }
        Text(
            ch.name, color = TextMain, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
            maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 8.dp),
        )
    }
}

@Composable
private fun ExpiryBanner(expiresAt: String) {
    if (expiresAt.isBlank()) return
    val days = remember(expiresAt) {
        try { Duration.between(Instant.now(), Instant.parse(expiresAt)).toDays() } catch (_: Exception) { null }
    } ?: return
    val text = when {
        days < 0 -> "انتهى اشتراكك — تواصل مع الإدارة للتجديد"
        days <= 3 -> "ينتهي اشتراكك خلال ${days + 1} يوم — جدّد قبل الانقطاع"
        else -> return
    }
    Box(
        Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (days < 0) Color(0x33F87171) else Color(0x33F59E0B))
            .padding(10.dp),
    ) {
        Text(text, color = if (days < 0) Danger else Color(0xFFFBBF24), fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
}
