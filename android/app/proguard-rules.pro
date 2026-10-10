# PhotoCraft for Android — release shrink rules.

# --- JNI bridge -------------------------------------------------------------
# The Rust engine (libphotocraft.so) calls these from C++ through JNI: their names must survive.
-keep class ai.storyteller.photocraft.core.NativeBridge { *; }
-keep class ai.storyteller.photocraft.core.EngineException { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}

# --- Serialized state -------------------------------------------------------
# Project metadata, brand kit and asset entries are persisted as JSON with these field names.
-keepclassmembers class ai.storyteller.photocraft.data.** {
    <fields>;
    <init>(...);
}

# --- ONNX Runtime -----------------------------------------------------------
-keep class ai.onnxruntime.** { *; }
-keep class com.microsoft.onnxruntime.** { *; }
-dontwarn com.microsoft.onnxruntime.**
# OrtEnvironment/Session use reflection over their own providers.
-keepclassmembers class ai.onnxruntime.OrtSession$SessionOptions { *; }

# --- AndroidX ---------------------------------------------------------------
-keep class androidx.window.** { *; }
-dontwarn androidx.window.**

# Debug information for crash reports of the release build.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
