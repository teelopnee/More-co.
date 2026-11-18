import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// scripts/build.mjs ส่งค่าพวกนี้มา (ค่าเริ่มต้นไว้สำหรับ build เองด้วยมือ)
val versionCodeValue = System.getenv("JARVIS_VERSION_CODE")?.toIntOrNull() ?: 3
val versionNameValue = System.getenv("JARVIS_VERSION_NAME") ?: "0.4.0"
// กุญแจเซ็นจริงไม่อยู่ใน repo: scripts/build.mjs เขียนไฟล์จาก GitHub Secret แล้วส่ง path มา
// ไม่มี = เซ็นด้วยกุญแจ debug ของเครื่องที่ build (รุ่นทดลอง ติดตั้งทับรุ่นที่ build จากเครื่องอื่นไม่ได้)
val keystoreFile = System.getenv("JARVIS_KEYSTORE")?.let { file(it) }?.takeIf { it.exists() }

android {
    namespace = "com.smott.jarvis"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.smott.jarvis"
        minSdk = 29
        targetSdk = 35
        versionCode = versionCodeValue
        versionName = versionNameValue
        // แท็บเล็ต/มือถือ Samsung ทุกรุ่นปัจจุบันเป็น arm64 — ใส่แค่สถาปัตยกรรมนี้ ลดขนาด ONNX Runtime (คำปลุก) ลงครึ่ง
        ndk { abiFilters += listOf("arm64-v8a") }
    }

    signingConfigs {
        if (keystoreFile != null) {
            create("stable") {
                storeFile = keystoreFile
                storePassword = System.getenv("JARVIS_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("JARVIS_KEY_ALIAS") ?: "paewai"
                keyPassword = System.getenv("JARVIS_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // ไม่ย่อโค้ด (ไม่เสี่ยงพังจาก R8) แต่เป็นรุ่น release จึงไม่ debuggable = แอนิเมชันลื่นกว่ารุ่น debug มาก
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName(if (keystoreFile != null) "stable" else "debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures { compose = true }

    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation(project(":core"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    // คำปลุก "Hey Jarvis" (openWakeWord) รันบนเครื่อง
    implementation(libs.onnxruntime.android)
}
