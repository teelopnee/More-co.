pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "JarvisTab"

// :core = สมองของผู้ช่วย (Kotlin ล้วน ไม่ผูกกับ Android) — ใช้ซ้ำกับเวอร์ชัน PC ได้ภายหลัง
// :app  = แอป Android (หน้าจอ, เสียง, คำสั่งอุปกรณ์)
include(":app", ":core")
