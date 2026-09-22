// إصدارات مثبّتة عمداً — تُبنى على السيرفر داخل صورة Docker (JDK 21 + SDK 36).
plugins {
    id("com.android.application") version "8.9.1" apply false
    id("org.jetbrains.kotlin.android") version "2.1.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.20" apply false
}
