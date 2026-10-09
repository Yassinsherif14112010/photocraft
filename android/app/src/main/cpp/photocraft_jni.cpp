// Photo Craft Mobile — JNI bridge between Kotlin and the PhotoCraft Rust core.
//
// The Rust side (rust-core/crates/android-ffi) exports a plain C ABI; this
// translation unit adapts it to JNI for `com.photocraft.mobile.engine.PhotoCraftJni`.
//
// ABI contract (must mirror rust-core/crates/android-ffi/src/lib.rs exactly —
// scripts/check_abi.py cross-checks both against the Kotlin declarations):
//   * sizes/lengths are uint64_t, pixel dimensions are uint32_t — never size_t,
//     so the calling convention is identical on armeabi-v7a and 64-bit ABIs;
//   * byte buffers are freed with pcm_buffer_free exactly once, including
//     zero-length ones (a non-null pointer with len 0 is still an allocation);
//   * session handles are opaque; free happens exactly once per handle;
//   * all Rust strings are standard UTF-8; JNI strings are modified UTF-8 —
//     both conversions below are explicit instead of relying on NewStringUTF.

#include <jni.h>
#include <android/log.h>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

extern "C" {
// ---- C ABI of libphotocraft_android_ffi.so (see rust-core/crates/android-ffi/src/lib.rs)
const char*    pcm_version();
void           pcm_string_free(char* s);
void           pcm_buffer_free(uint8_t* ptr, uint64_t len);
void*          pcm_session_new();
void           pcm_session_free(void* session);
char*          pcm_call(const void* session, const char* method, const char* params_json);
char*          pcm_command_list(const void* session);
uint8_t*       pcm_render_rgba(const void* session, uint32_t max_side,
                               uint64_t* out_len, uint32_t* out_w, uint32_t* out_h);
uint8_t*       pcm_rgba8_to_png(const uint8_t* rgba, uint64_t len,
                                uint32_t width, uint32_t height,
                                uint64_t* out_len);
} // extern "C"

#define PCM_LOG(...) __android_log_print(ANDROID_LOG_INFO, "PhotoCraftJNI", __VA_ARGS__)

namespace {

// ---------------------------------------------------------------------------
// UTF handling — JNI uses *modified* UTF-8, the engine emits standard UTF-8.
// NewStringUTF corrupts (and with CheckJNI aborts on) 4-byte UTF-8 sequences
// (emoji, rare CJK extensions) and embedded NULs, so we convert through
// UTF-16 explicitly. Arabic itself is BMP and round-trips either way, but OCR
// results and layer names are user data and must survive exactly.
// ---------------------------------------------------------------------------

bool appendUtf16CodePoint(std::u16string& out, uint32_t cp) {
    if (cp > 0x10FFFF) return false;
    if (cp >= 0xD800 && cp <= 0xDFFF) return false; // lone surrogate in input
    if (cp < 0x10000) {
        out.push_back(static_cast<char16_t>(cp));
    } else {
        cp -= 0x10000;
        out.push_back(static_cast<char16_t>(0xD800 + (cp >> 10)));
        out.push_back(static_cast<char16_t>(0xDC00 + (cp & 0x3FF)));
    }
    return true;
}

/** Decode standard UTF-8 (also tolerates CESU-8 surrogate encodings) to UTF-16. */
bool utf8ToUtf16(const char* in, size_t inLen, std::u16string& out) {
    out.clear();
    size_t i = 0;
    while (i < inLen) {
        const uint8_t b0 = static_cast<uint8_t>(in[i]);
        if (b0 < 0x80) {
            out.push_back(static_cast<char16_t>(b0));
            i += 1;
            continue;
        }
        unsigned extra = 0;
        uint32_t cp = 0;
        if ((b0 & 0xE0) == 0xC0) { extra = 1; cp = b0 & 0x1F; }
        else if ((b0 & 0xF0) == 0xE0) { extra = 2; cp = b0 & 0x0F; }
        else if ((b0 & 0xF8) == 0xF0) { extra = 3; cp = b0 & 0x07; }
        else return false; // stray continuation byte
        if (i + extra >= inLen) return false; // truncated sequence
        bool ok = true;
        for (unsigned k = 1; k <= extra && ok; ++k) {
            const uint8_t bk = static_cast<uint8_t>(in[i + k]);
            if ((bk & 0xC0) != 0x80) ok = false;
            else cp = (cp << 6) | (bk & 0x3F);
        }
        if (!ok) return false;
        if (extra == 3) {
            if (!appendUtf16CodePoint(out, cp)) return false;
        } else if (extra == 2 && cp >= 0xD800 && cp <= 0xDFFF) {
            // CESU-8 (JNI modified UTF-8): a 3-byte-encoded surrogate. Keep it;
            // a well-formed pair combines below via the surrogate passthrough.
            out.push_back(static_cast<char16_t>(cp));
        } else if (cp < (extra == 1 ? 0x80u : extra == 2 ? 0x800u : 0x10000u)) {
            return false; // overlong encoding
        } else {
            out.push_back(static_cast<char16_t>(cp));
        }
        i += extra + 1;
    }
    return true;
}

/** Combine CESU-8 style unpaired surrogate pairs produced by GetStringUTFChars. */
void combineSurrogatePairs(std::u16string& s) {
    std::u16string out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size(); ++i) {
        const char16_t hi = s[i];
        if (hi >= 0xD800 && hi <= 0xDBFF && i + 1 < s.size() &&
            s[i + 1] >= 0xDC00 && s[i + 1] <= 0xDFFF) {
            out.push_back(hi);
            out.push_back(s[i + 1]);
            ++i;
        } else {
            out.push_back(hi);
        }
    }
    s.swap(out);
}

jstring toJString(JNIEnv* env, char* rustStr) {
    if (rustStr == nullptr) {
        return env->NewStringUTF("{}");
    }
    const size_t len = std::strlen(rustStr);
    std::u16string utf16;
    jstring result = nullptr;
    if (utf8ToUtf16(rustStr, len, utf16)) {
        result = env->NewString(reinterpret_cast<const jchar*>(utf16.data()),
                                static_cast<jsize>(utf16.size()));
    }
    pcm_string_free(rustStr);
    if (result == nullptr) {
        env->ExceptionClear();
        // Lossless conversion failed (invalid bytes / OOM): fall back to a
        // replace-invalid ASCII-safe JSON rather than crashing the app.
        result = env->NewStringUTF("{\"error\":\"text conversion failed\"}");
    }
    return result;
}

/** Read a jstring as standard UTF-8 (JNI hands us modified UTF-8). */
std::string jstringToStdUtf8(JNIEnv* env, jstring str, bool* ok) {
    std::string out;
    if (str == nullptr) {
        if (ok) *ok = true;
        return out;
    }
    const char* chars = env->GetStringUTFChars(str, nullptr);
    if (chars == nullptr) {
        if (ok) *ok = false;
        return out;
    }
    const size_t len = std::strlen(chars);
    std::u16string utf16;
    if (!utf8ToUtf16(chars, len, utf16)) {
        env->ReleaseStringUTFChars(str, chars);
        if (ok) *ok = false;
        return out;
    }
    env->ReleaseStringUTFChars(str, chars);
    combineSurrogatePairs(utf16);
    // UTF-16 → standard UTF-8 (surrogate pairs → 4-byte sequences).
    out.reserve(utf16.size());
    for (size_t i = 0; i < utf16.size(); ++i) {
        const uint32_t u = static_cast<uint16_t>(utf16[i]);
        if (u < 0x80) {
            out.push_back(static_cast<char>(u));
        } else if (u < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (u >> 6)));
            out.push_back(static_cast<char>(0x80 | (u & 0x3F)));
        } else if (u < 0xD800 || u > 0xDFFF) {
            out.push_back(static_cast<char>(0xE0 | (u >> 12)));
            out.push_back(static_cast<char>(0x80 | ((u >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (u & 0x3F)));
        } else if (u <= 0xDBFF && i + 1 < utf16.size()) {
            const uint32_t lo = static_cast<uint16_t>(utf16[i + 1]);
            if (lo >= 0xDC00 && lo <= 0xDFFF) {
                const uint32_t cp = 0x10000 + ((u - 0xD800) << 10) + (lo - 0xDC00);
                out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
                out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
                out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
                out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
                ++i;
                continue;
            }
            out.push_back(static_cast<char>(0xE0 | (u >> 12)));
            out.push_back(static_cast<char>(0x80 | ((u >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (u & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xE0 | (u >> 12)));
            out.push_back(static_cast<char>(0x80 | ((u >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (u & 0x3F)));
        }
    }
    if (ok) *ok = true;
    return out;
}

/**
 * Wrap a Rust-allocated byte buffer into a jbyteArray and release the Rust
 * allocation exactly once — including the len==0 case (non-null pointer is a
 * real boxed-slice allocation even when empty).
 */
jbyteArray toJByteArray(JNIEnv* env, uint8_t* data, uint64_t len) {
    if (data == nullptr) {
        return env->NewByteArray(0);
    }
    if (len > static_cast<uint64_t>(INT32_MAX)) {
        pcm_buffer_free(data, len);
        PCM_LOG("buffer too large for jbyteArray: %llu bytes", (unsigned long long)len);
        return env->NewByteArray(0);
    }
    const jsize n = static_cast<jsize>(len);
    jbyteArray arr = env->NewByteArray(n);
    if (arr == nullptr) {
        env->ExceptionClear();
        pcm_buffer_free(data, len);
        return env->NewByteArray(0);
    }
    if (n > 0) {
        env->SetByteArrayRegion(arr, 0, n, reinterpret_cast<const jbyte*>(data));
        if (env->ExceptionCheck() == JNI_TRUE) {
            env->ExceptionClear();
            env->DeleteLocalRef(arr);
            pcm_buffer_free(data, len);
            return env->NewByteArray(0);
        }
    }
    pcm_buffer_free(data, len);
    return arr;
}

inline void* sessionPtr(jlong handle) { return reinterpret_cast<void*>(handle); }

} // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_com_photocraft_mobile_engine_PhotoCraftJni_nativeVersion(JNIEnv* env, jclass) {
    const char* v = pcm_version();
    return env->NewStringUTF(v != nullptr ? v : "{}");
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
    if (method == nullptr || paramsJson == nullptr) {
        return env->NewStringUTF("{\"error\":\"null argument to nativeCall\"}");
    }
    bool ok = false;
    const std::string methodC = jstringToStdUtf8(env, method, &ok);
    if (!ok) return env->NewStringUTF("{\"error\":\"bad method encoding\"}");
    const std::string paramsC = jstringToStdUtf8(env, paramsJson, &ok);
    if (!ok) return env->NewStringUTF("{\"error\":\"bad params encoding\"}");
    char* result = pcm_call(sessionPtr(session), methodC.c_str(), paramsC.c_str());
    return toJString(env, result);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_photocraft_mobile_engine_PhotoCraftJni_nativeCommandList(JNIEnv* env, jclass, jlong session) {
    if (session == 0) {
        return env->NewStringUTF("[]");
    }
    return toJString(env, pcm_command_list(sessionPtr(session)));
}

/**
 * Render the composite; `sizeOut` (a LongArray of length >= 3) receives
 * [len, width, height] so Kotlin never has to guess the buffer layout.
 */
extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_photocraft_mobile_engine_PhotoCraftJni_nativeRenderRgba(
        JNIEnv* env, jclass, jlong session, jint maxSide, jlongArray sizeOut) {
    if (session == 0 || maxSide <= 0) {
        return env->NewByteArray(0);
    }
    uint64_t len = 0;
    uint32_t w = 0, h = 0;
    uint8_t* rgba = pcm_render_rgba(sessionPtr(session),
                                    static_cast<uint32_t>(maxSide), &len, &w, &h);
    if (sizeOut != nullptr && env->GetArrayLength(sizeOut) >= 3) {
        const jlong sizes[3] = {static_cast<jlong>(len),
                                static_cast<jlong>(w),
                                static_cast<jlong>(h)};
        env->SetLongArrayRegion(sizeOut, 0, 3, sizes);
        if (env->ExceptionCheck() == JNI_TRUE) {
            env->ExceptionClear();
        }
    }
    if (rgba != nullptr && (w == 0 || h == 0 ||
        len != static_cast<uint64_t>(w) * h * 4)) {
        // Defensive: the contract guarantees len == w*h*4; refuse a corrupt frame.
        PCM_LOG("render size mismatch: len=%llu w=%u h=%u", (unsigned long long)len, w, h);
        pcm_buffer_free(rgba, len);
        return env->NewByteArray(0);
    }
    return toJByteArray(env, rgba, len);
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_photocraft_mobile_engine_PhotoCraftJni_nativeRgba8ToPng(
        JNIEnv* env, jclass, jbyteArray rgba, jint width, jint height) {
    if (rgba == nullptr || width <= 0 || height <= 0) {
        return env->NewByteArray(0);
    }
    const jsize len = env->GetArrayLength(rgba);
    if (len <= 0) {
        return env->NewByteArray(0);
    }
    jbyte* bytes = env->GetByteArrayElements(rgba, nullptr);
    if (bytes == nullptr) {
        env->ExceptionClear();
        return env->NewByteArray(0);
    }
    uint64_t outLen = 0;
    uint8_t* png = pcm_rgba8_to_png(reinterpret_cast<const uint8_t*>(bytes),
                                    static_cast<uint64_t>(len),
                                    static_cast<uint32_t>(width),
                                    static_cast<uint32_t>(height),
                                    &outLen);
    env->ReleaseByteArrayElements(rgba, bytes, JNI_ABORT);
    return toJByteArray(env, png, outLen);
}
