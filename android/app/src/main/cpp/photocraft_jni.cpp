// Photo Craft Mobile — JNI bridge between Kotlin and the PhotoCraft Rust core.
//
// The Rust side (rust-core/crates/android-ffi) exports a plain C ABI; this
// translation unit adapts it to JNI for `com.photocraft.mobile.engine.PhotoCraftJni`.
// All heavy work happens inside the Rust engine (document model, layers, masks,
// blend modes, layer styles, text shaping/layout, SVG, PSD/PSB, export codecs).

#include <jni.h>
#include <android/log.h>
#include <cstring>
#include <string>

extern "C" {
// ---- C ABI of libphotocraft_android_ffi.so (see rust-core/crates/android-ffi/src/lib.rs)
const char* pcm_version();
void        pcm_string_free(char* s);
void        pcm_buffer_free(unsigned char* ptr, unsigned long long len);
void*       pcm_session_new();
void        pcm_session_free(void* session);
char*       pcm_call(void* session, const char* method, const char* params_json);
char*       pcm_command_list(void* session);
unsigned char* pcm_render_rgba(void* session, unsigned int max_side, unsigned long long* out_len);
unsigned char* pcm_rgba8_to_png(const unsigned char* rgba, unsigned long long len,
                                unsigned int width, unsigned int height,
                                unsigned long long* out_len);
} // extern "C"

#define PCM_LOG(...) __android_log_print(ANDROID_LOG_INFO, "PhotoCraftJNI", __VA_ARGS__)

namespace {

// Copy a Rust-allocated C string into a jstring and release the Rust buffer.
jstring toJString(JNIEnv* env, char* rustStr) {
    if (rustStr == nullptr) {
        return env->NewStringUTF("{}");
    }
    std::string owned(rustStr);
    pcm_string_free(rustStr);
    // JNI's NewStringUTF expects modified-UTF8; the engine emits valid JSON that is
    // escaped to ASCII, so direct conversion is safe here.
    return env->NewStringUTF(owned.c_str());
}

jbyteArray toJByteArray(JNIEnv* env, unsigned char* data, unsigned long long len) {
    if (data == nullptr || len == 0) {
        return env->NewByteArray(0);
    }
    jbyteArray arr = env->NewByteArray(static_cast<jsize>(len));
    env->SetByteArrayRegion(arr, 0, static_cast<jsize>(len),
                            reinterpret_cast<const jbyte*>(data));
    pcm_buffer_free(data, len);
    return arr;
}

inline void* sessionPtr(jlong handle) { return reinterpret_cast<void*>(handle); }

} // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_com_photocraft_mobile_engine_PhotoCraftJni_nativeVersion(JNIEnv* env, jclass) {
    return env->NewStringUTF(pcm_version());
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_photocraft_mobile_engine_PhotoCraftJni_nativeSessionNew(JNIEnv*, jclass) {
    void* s = pcm_session_new();
    return reinterpret_cast<jlong>(s);
}

extern "C" JNIEXPORT void JNICALL
Java_com_photocraft_mobile_engine_PhotoCraftJni_nativeSessionFree(JNIEnv*, jclass, jlong session) {
    if (session != 0) {
        pcm_session_free(sessionPtr(session));
    }
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_photocraft_mobile_engine_PhotoCraftJni_nativeCall(
        JNIEnv* env, jclass, jlong session, jstring method, jstring paramsJson) {
    if (session == 0) {
        return env->NewStringUTF("{\"error\":\"no session\"}");
    }
    const char* methodC = env->GetStringUTFChars(method, nullptr);
    const char* paramsC = env->GetStringUTFChars(paramsJson, nullptr);
    char* result = pcm_call(sessionPtr(session), methodC, paramsC);
    env->ReleaseStringUTFChars(method, methodC);
    env->ReleaseStringUTFChars(paramsJson, paramsC);
    return toJString(env, result);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_photocraft_mobile_engine_PhotoCraftJni_nativeCommandList(JNIEnv* env, jclass, jlong session) {
    if (session == 0) {
        return env->NewStringUTF("[]");
    }
    return toJString(env, pcm_command_list(sessionPtr(session)));
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_photocraft_mobile_engine_PhotoCraftJni_nativeRenderRgba(
        JNIEnv* env, jclass, jlong session, jint maxSide) {
    if (session == 0) {
        return env->NewByteArray(0);
    }
    unsigned long long len = 0;
    unsigned char* rgba = pcm_render_rgba(sessionPtr(session),
                                          static_cast<unsigned int>(maxSide), &len);
    return toJByteArray(env, rgba, len);
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_photocraft_mobile_engine_PhotoCraftJni_nativeRgba8ToPng(
        JNIEnv* env, jclass, jbyteArray rgba, jint width, jint height) {
    jsize len = env->GetArrayLength(rgba);
    jbyte* bytes = env->GetByteArrayElements(rgba, nullptr);
    unsigned long long outLen = 0;
    unsigned char* png = pcm_rgba8_to_png(reinterpret_cast<const unsigned char*>(bytes),
                                          static_cast<unsigned long long>(len),
                                          static_cast<unsigned int>(width),
                                          static_cast<unsigned int>(height),
                                          &outLen);
    env->ReleaseByteArrayElements(rgba, bytes, JNI_ABORT);
    return toJByteArray(env, png, outLen);
}
