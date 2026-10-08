cmake_minimum_required(VERSION 3.22.1)
project(photocraft_mobile_jni)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The Rust core (libphotocraft_android_ffi.so) is produced by scripts/build-android.sh
# with cargo-ndk into app/src/main/jniLibs/<ABI>/.
set(PHOTOCRAFT_JNILIBS "${PHOTOCRAFT_JNILIBS}" CACHE PATH "Directory holding the Rust cdylib per ABI")
if(NOT PHOTOCRAFT_JNILIBS)
    set(PHOTOCRAFT_JNILIBS "${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs")
endif()

add_library(photocraft_ffi SHARED IMPORTED)
set_target_properties(photocraft_ffi PROPERTIES
    IMPORTED_LOCATION "${PHOTOCRAFT_JNILIBS}/${ANDROID_ABI}/libphotocraft_android_ffi.so")

add_library(photocraft_mobile_jni SHARED photocraft_jni.cpp)

target_include_directories(photocraft_mobile_jni PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(photocraft_mobile_jni
    photocraft_ffi
    android
    log)
