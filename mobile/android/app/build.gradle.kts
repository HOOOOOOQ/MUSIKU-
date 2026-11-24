import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing is configured only from mobile/android/key.properties, which
// CI writes from repository secrets and never commits. Values are never logged.
val signing = Properties()
val signingFile = rootProject.file("key.properties")
if (signingFile.exists()) {
    signingFile.inputStream().use { stream -> signing.load(stream) }
}
val keystorePath = signing.getProperty("storeFile")?.takeIf { it.isNotBlank() }
val hasReleaseSigning = keystorePath != null &&
    signing.getProperty("storePassword")?.isNotBlank() == true &&
    signing.getProperty("keyAlias")?.isNotBlank() == true &&
    signing.getProperty("keyPassword")?.isNotBlank() == true

android {
    namespace = "com.musikuplus.app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.musikuplus.app"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(keystorePath!!)
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // Release signing comes only from owner-supplied material. The debug
            // keystore is deliberately NOT used as a fallback: an artifact signed
            // with a debug key must never be mistaken for a distributable build.
            // Without key.properties the output stays unsigned.
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
