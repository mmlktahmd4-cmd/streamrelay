pluginManagement {
    repositories {
        // مرآة Google Maven: dl.google.com محجوب من سوريا
        maven("https://maven.aliyun.com/repository/google")
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        // مرآة Google Maven: dl.google.com محجوب من سوريا
        maven("https://maven.aliyun.com/repository/google")
        google()
        mavenCentral()
    }
}

rootProject.name = "StreamRelayTV"
include(":app")
