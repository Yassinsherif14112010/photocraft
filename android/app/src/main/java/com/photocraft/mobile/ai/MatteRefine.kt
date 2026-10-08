package com.photocraft.mobile.ai

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix

/**
 * Matte post-processing for the on-device BiRefNet pipeline: hard threshold,
 * separable box-blur edge smoothing, feathering and edge shift. These are real
 * image operations on the raw 0..1 matte BEFORE it becomes a layer mask, so
 * the editor mask stays fully editable and PSD-exportable.
 */
object MatteRefine {

    /** Hard cut: everything below `threshold` becomes 0 (0 disables). */
    fun threshold(matte: FloatArray, threshold: Float): FloatArray {
        if (threshold <= 0f) return matte
        val out = FloatArray(matte.size)
        for (i in out.indices) {
            val v = matte[i]
            out[i] = if (v >= threshold) maxOf(v, threshold) else 0f
        }
        return out
    }

    /** Edge smoothing / feathering: `radius` passes of a separable box blur. */
    fun smooth(matte: FloatArray, size: Int, radius: Float): FloatArray {
        if (radius <= 0f) return matte
        val r = radius.toInt().coerceIn(1, 16)
        var cur = matte
        // Two passes (H+V) approximate a gaussian well enough for mask edges.
        repeat(2) {
            cur = boxBlurH(cur, size, r)
            cur = boxBlurV(cur, size, r)
        }
        return cur
    }

    /** Shift the mask edge in/out (-1..1): positive shrinks the subject. */
    fun shiftEdge(matte: FloatArray, shift: Float): FloatArray {
        if (shift == 0f) return matte
        val out = FloatArray(matte.size)
        for (i in out.indices) {
            out[i] = (matte[i] + shift).coerceIn(0f, 1f)
        }
        return out
    }

    /** Full chain in the canonical order: threshold → shift → smooth. */
    fun refine(
        matte: FloatArray,
        size: Int,
        threshold: Float,
        edgeSmooth: Float,
        feather: Float,
        shiftEdge: Float,
    ): FloatArray {
        var m = threshold(matte, threshold)
        m = shiftEdge(m, shiftEdge)
        if (edgeSmooth > 0f) m = smooth(m, size, edgeSmooth)
        if (feather > 0f) m = smooth(m, size, feather)
        return m
    }

    // ---------------------------------------------------------------- blur

    private fun boxBlurH(src: FloatArray, size: Int, r: Int): FloatArray {
        val out = FloatArray(src.size)
        val norm = 1f / (2 * r + 1)
        for (y in 0 until size) {
            val row = y * size
            var acc = 0f
            for (k in -r..r) acc += src[row + k.coerceIn(0, size - 1)]
            for (x in 0 until size) {
                out[row + x] = acc * norm
                val add = src[row + (x + r + 1).coerceAtMost(size - 1)]
                val sub = src[row + (x - r).coerceAtLeast(0)]
                acc += add - sub
            }
        }
        return out
    }

    private fun boxBlurV(src: FloatArray, size: Int, r: Int): FloatArray {
        val out = FloatArray(src.size)
        val norm = 1f / (2 * r + 1)
        for (x in 0 until size) {
            var acc = 0f
            for (k in -r..r) acc += src[k.coerceIn(0, size - 1) * size + x]
            for (y in 0 until size) {
                out[y * size + x] = acc * norm
                val add = src[(y + r + 1).coerceAtMost(size - 1) * size + x]
                val sub = src[(y - r).coerceAtLeast(0) * size + x]
                acc += add - sub
            }
        }
        return out
    }

    /** Scale an ARGB bitmap to `size`×`size`. */
    fun scaled(src: Bitmap, size: Int): Bitmap {
        if (src.width == size && src.height == size) return src
        val m = Matrix().apply { postScale(size.toFloat() / src.width, size.toFloat() / src.height) }
        return Bitmap.createBitmap(src, 0, 0, src.width, src.height, m, true)
    }

    /** Compose source pixels with a matte as the alpha channel (both size×size). */
    fun compose(src: Bitmap, matte: FloatArray, size: Int): Bitmap {
        val scaledSrc = scaled(src, size)
        val pixels = IntArray(size * size)
        scaledSrc.getPixels(pixels, 0, size, 0, 0, size, size)
        for (i in pixels.indices) {
            val a = (matte[i].coerceIn(0f, 1f) * 255f).toInt()
            pixels[i] = (a shl 24) or (pixels[i] and 0x00FFFFFF)
        }
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        out.setPixels(pixels, 0, size, 0, 0, size, size)
        return out
    }

    /** Grayscale preview bitmap of a matte (for the mask preview UI). */
    fun preview(matte: FloatArray, size: Int): Bitmap {
        val pixels = IntArray(size * size)
        for (i in pixels.indices) {
            val v = (matte[i].coerceIn(0f, 1f) * 255f).toInt()
            pixels[i] = (0xFF shl 24) or (v shl 16) or (v shl 8) or v
        }
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        out.setPixels(pixels, 0, size, 0, 0, size, size)
        return out
    }

    /** Draw a bitmap over a white canvas (helper shared with OCR cropping). */
    fun drawOnCanvas(src: Bitmap, out: Bitmap) {
        val c = Canvas(out)
        c.drawBitmap(src, 0f, 0f, null)
    }
}
