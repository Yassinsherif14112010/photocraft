# Photo Craft Mobile — keep the JNI bridge to the Rust engine
-keep class com.photocraft.mobile.engine.PhotoCraftJni { *; }
-keepclasseswithmembernames class * { native <methods>; }

# ONNX Runtime
-keep class ai.onnxruntime.** { *; }
-dontwarn ai.onnxruntime.**
