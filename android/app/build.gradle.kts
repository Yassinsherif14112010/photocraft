import java.io.ByteArrayOutputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ---------------------------------------------------------------------------
// PhotoCraft for Android.
//
// The editing engine is the real Rust engine from this repository (crates/engine and friends),
// compiled for Android by cargo-ndk from android/jni-rust and shipped as libphotocraft.so.
// This Gradle module is the Kotlin shell: activities, adaptive resources, ONNX Runtime
// background removal, project storage. It contains no image processing of its own.
// ---------------------------------------------------------------------------

val cargoSkip = (project.findProperty("photocraft.skipNative") as String?)?.toBoolean() ?: false
val abis = ((project.findProperty("photocraft.abis") as String?) ?: "arm64-v8a,armeabi-v7a,x86_64")
    .split(',').map { it.trim() }.filter { it.isNotEmpty() }
val cargoProfile = (project.findProperty("photocraft.cargoProfile") as String?) ?: "release"
val jniDir = layout.projectDirectory.dir("src/main/jniLibs")
val rustDir = rootProject.layout.projectDirectory.dir("jni-rust")

android {
    namespace = "ai.storyteller.photocraft"
    compileSdk = 35

    defaultConfig {
        applicationId = "ai.storyteller.photocraft"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.5.0"
        // The Rust engine's version, shown in Settings › About.
        buildConfigField("String", "ENGINE_VERSION", "\"0.5.0\"")
        resourceConfigurations += setOf("en", "ar")
        ndk {
            abiFilters += abis
        }
    }

    signingConfigs {
        // Debug signing only. Release keys are never committed: see docs/android.md › Signing.
        getByName("debug") {
            storeFile = file("${System.getProperty("user.home")}/.android/debug.keystore")
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs += listOf("-opt-in=kotlin.RequiresOptIn")
    }

    packaging {
        resources {
            // ONNX Runtime ships both; the first one on the classpath wins.
            excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "META-INF/DEPENDENCIES")
        }
        jniLibs {
            // Keep every ABI's libphotocraft.so and the ONNX Runtime native libraries.
            useLegacyPackaging = false
            keepDebugSymbols += setOf("**/libphotocraft.so")
        }
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    // One APK per ABI keeps the download small (each is ~9 MB + the engine).
    splits {
        abi {
            isEnable = true
            reset()
            include(*abis.toTypedArray())
            isUniversalApk = true
        }
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        disable += setOf("MissingTranslation", "ExtraTranslation")
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    sourceSets {
        getByName("main") {
            jniLibs.srcDirs("src/main/jniLibs")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("androidx.fragment:fragment-ktx:1.8.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-livedata-ktx:2.8.4")
    // Foldables, window size classes, split-screen and posture.
    implementation("androidx.window:window:1.2.0")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("androidx.exifinterface:exifinterface:1.3.7")

    // Local, on-device background removal (BiRefNet ONNX). No network call at inference time.
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.19.2")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.test:rules:1.6.1")
}

// ---------------------------------------------------------------------------
// Rust engine build (cargo-ndk).
// ---------------------------------------------------------------------------

fun execCapture(vararg cmd: String): String? = try {
    val out = ByteArrayOutputStream()
    val result = exec {
        commandLine(*cmd)
        standardOutput = out
        errorOutput = ByteArrayOutputStream()
        isIgnoreExitValue = true
    }
    if (result.exitValue == 0) out.toString().trim() else null
} catch (e: Exception) {
    null
}

val buildRust = tasks.register("buildRust") {
    group = "photocraft"
    description = "Builds the Rust engine (libphotocraft.so) for Android with cargo-ndk."
    inputs.dir(rustDir.dir("src"))
    inputs.file(rustDir.file("Cargo.toml"))
    inputs.dir(rootProject.layout.projectDirectory.dir("crates"))
    inputs.property("profile", cargoProfile)
    inputs.property("abis", abis)
    outputs.dir(jniDir)

    doLast {
        if (cargoSkip) {
            val present = abis.filter { jniDir.dir(it).file("libphotocraft.so").asFile.exists() }
            if (present.size != abis.size) {
                throw GradleException(
                    "photocraft.skipNative=true but libphotocraft.so is missing for " +
                        abis.filter { it !in present }.joinToString(", ") +
                        ". Build it with scripts/build-android.sh or remove the flag."
                )
            }
            logger.lifecycle("Skipping the Rust build (photocraft.skipNative=true).")
            return@doLast
        }

        val cargo = execCapture("cargo", "--version")
            ?: throw GradleException(
                "cargo was not found on PATH. Install the Rust toolchain (rust-version 1.95 or newer, " +
                    "see Cargo.toml) and run scripts/check-prereqs.sh to verify the setup."
            )
        if (execCapture("cargo", "ndk", "--version") == null) {
            throw GradleException(
                "cargo-ndk was not found. Install it with: cargo install cargo-ndk@4"
            )
        }
        val ndkHome = android.ndkDirectory
            ?: throw GradleException(
                "the Android NDK is not installed. Install it with: sdkmanager \"ndk;27.0.12077973\""
            )
        logger.lifecycle("Building the engine with $cargo (NDK ${ndkHome.name}) for ${abis.joinToString(", ")}")

        val args = mutableListOf("ndk", "-o", jniDir.asFile.absolutePath, "--manifest-path", rustDir.file("Cargo.toml").asFile.absolutePath)
        for (abi in abis) {
            args += "-t"
            args += abi
        }
        args += "build"
        if (cargoProfile == "release") args += "--release"

        val failure = exec {
            commandLine("cargo", *args.toTypedArray())
            environment("ANDROID_NDK_HOME", ndkHome.absolutePath)
            // Keep the JVM honest about memory: the engine links 3 ABIs.
            environment("CARGO_NET_RETRY", "3")
        }
        // `exec` throws on a non-zero exit code, so reaching here means success.
        for (abi in abis) {
            val so = jniDir.dir(abi).file("libphotocraft.so").asFile
            check(so.exists() && so.length() > 0) { "cargo ndk produced no libphotocraft.so for $abi" }
        }
        logger.lifecycle("Engine built: ${abis.joinToString(", ") { "$it ✓" }}")
    }
}

// The Rust engine must exist before resources are merged: it is packaged as a jniLib.
tasks.named("preBuild") { dependsOn(buildRust) }
tasks.named("mergeDebugJniLibFolders") { dependsOn(buildRust) }
tasks.named("mergeReleaseJniLibFolders") { dependsOn(buildRust) }

tasks.register("printEngineInfo") {
    group = "photocraft"
    doLast {
        println("engine       : android/jni-rust (crate photocraft-jni, libphotocraft.so)")
        println("profile      : $cargoProfile")
        println("abis         : ${abis.joinToString(", ")}")
        println("onnx runtime : 1.19.2")
    }
}
