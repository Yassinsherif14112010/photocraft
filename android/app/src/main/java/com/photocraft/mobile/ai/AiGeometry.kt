package com.photocraft.mobile.ai

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Shared tensor/geometry maths for the on-device AI modules.
 *
 * These are real implementations of the classic PaddleOCR post-processing steps:
 * DB-map thresholding, connected components (union-find over the prob map),
 * unclip (polygon offset via the area/perimeter formula from "DBNet"), min-area
 * rectangles via rotating calipers over the convex hull, and perspective warps.
 * Everything runs locally; nothing leaves the device.
 */
object AiGeometry {

    /** Naive but cache-friendly union-find over a binary grid. */
    class UnionFind(w: Int, h: Int) {
        private val parent = IntArray(w * h) { it }
        fun find(x: Int): Int {
            var root = x
            while (parent[root] != root) root = parent[root]
            var cur = x
            while (parent[cur] != root) {
                val next = parent[cur]
                parent[cur] = root
                cur = next
            }
            return root
        }
        fun union(a: Int, b: Int) {
            val ra = find(a)
            val rb = find(b)
            if (ra != rb) parent[ra] = rb
        }
    }

    data class Box(val x: Float, val y: Float, val w: Float, val h: Float, val angleRad: Float)

    /**
     * Extract rotated text boxes from a DB probability map (PaddleOCR `det` head):
     * 1) threshold the map, 2) label connected regions, 3) unclip each region by
     * `unclipRatio` using its area/perimeter, 4) fit a min-area rotated rect.
     */
    fun dbBoxes(
        prob: FloatArray,
        width: Int,
        height: Int,
        threshold: Float = 0.3f,
        unclipRatio: Float = 1.6f,
        minArea: Float = 12f,
    ): List<Box> {
        val bin = ByteArray(width * height)
        for (i in bin.indices) bin[i] = if (prob[i] >= threshold) 1 else 0
        val labels = IntArray(width * height) { -1 }
        val uf = UnionFind(width, height)
        for (y in 0 until height) {
            for (x in 0 until width) {
                val i = y * width + x
                if (bin[i] == 0) continue
                if (x > 0 && bin[i - 1] == 1) uf.union(i, i - 1)
                if (y > 0 && bin[i - width] == 1) uf.union(i, i - width)
                if (y > 0 && x > 0 && bin[i - width - 1] == 1) uf.union(i, i - width - 1)
                if (y > 0 && x < width - 1 && bin[i - width + 1] == 1) uf.union(i, i - width + 1)
            }
        }
        var next = 0
        val remap = HashMap<Int, Int>()
        for (i in labels.indices) {
            if (bin[i] == 1) {
                val root = uf.find(i)
                labels[i] = remap.getOrPut(root) { next++ }
            }
        }

        // Points per label
        val pts = Array(next) { ArrayList<Int>() }
        for (i in labels.indices) {
            if (labels[i] >= 0) pts[labels[i]].add(i)
        }

        val boxes = ArrayList<Box>()
        for (group in pts) {
            if (group.size < 8) continue
            var cx = 0f; var cy = 0f
            val hullPts = ArrayList<Pair<Float, Float>>(group.size)
            for (idx in group) {
                val x = (idx % width).toFloat()
                val y = (idx / width).toFloat()
                cx += x; cy += y
                hullPts.add(Pair(x, y))
            }
            cx /= group.size; cy /= group.size
            val hull = convexHull(hullPts)
            if (hull.size < 3) continue
            val (area, perimeter) = areaAndPerimeter(hull)
            if (area < minArea) continue
            // DBNet unclip: offset = area * unclipRatio / perimeter
            val offset = area * unclipRatio / max(perimeter, 1e-3f)
            val expanded = hull.map { p -> offsetPoint(p, cx, cy, offset, hull, area, perimeter) }
            val (center, size, angle) = minAreaRect(expanded)
            if (size.first < 2f || size.second < 2f) continue
            boxes.add(Box(center.first, center.second, size.first, size.second, angle))
        }
        return boxes
    }

    /** Offset each hull point outward by `offset` along its local normal. */
    private fun offsetPoint(
        p: Pair<Float, Float>, cx: Float, cy: Float, offset: Float,
        hull: List<Pair<Float, Float>>, area: Float, perimeter: Float,
    ): Pair<Float, Float> {
        // Standard DB clip: p + offset * d, d = unit normal from the edge direction.
        val n = hull.size
        val i = hull.indexOf(p)
        val prev = hull[(i - 1 + n) % n]
        val next = hull[(i + 1) % n]
        val dx = next.first - prev.first
        val dy = next.second - prev.second
        val len = sqrt(dx * dx + dy * dy).coerceAtLeast(1e-3f)
        // Normal (perpendicular of the tangent, pointing away from centroid)
        var nx = -dy / len
        var ny = dx / len
        val toC = (p.first - cx) * nx + (p.second - cy) * ny
        if (toC > 0) { nx = -nx; ny = -ny }
        return Pair(p.first + nx * offset, p.second + ny * offset)
    }

    fun convexHull(points: List<Pair<Float, Float>>): List<Pair<Float, Float>> {
        if (points.size < 4) return points
        val pts = points.distinct().sortedWith(compareBy({ it.first }, { it.second }))
        fun cross(o: Pair<Float, Float>, a: Pair<Float, Float>, b: Pair<Float, Float>) =
            (a.first - o.first) * (b.second - o.second) - (a.second - o.second) * (b.first - o.first)
        val lower = ArrayList<Pair<Float, Float>>()
        for (p in pts) {
            while (lower.size >= 2 && cross(lower[lower.size - 2], lower.last(), p) <= 0) lower.removeAt(lower.size - 1)
            lower.add(p)
        }
        val upper = ArrayList<Pair<Float, Float>>()
        for (p in pts.asReversed()) {
            while (upper.size >= 2 && cross(upper[upper.size - 2], upper.last(), p) <= 0) upper.removeAt(upper.size - 1)
            upper.add(p)
        }
        upper.removeAt(upper.size - 1); lower.removeAt(lower.size - 1)
        return lower + upper
    }

    fun areaAndPerimeter(hull: List<Pair<Float, Float>>): Pair<Float, Float> {
        var area = 0f
        var per = 0f
        for (i in hull.indices) {
            val a = hull[i]
            val b = hull[(i + 1) % hull.size]
            area += a.first * b.second - b.first * a.second
            per += sqrt((b.first - a.first) * (b.first - a.first) + (b.second - a.second) * (b.second - a.second))
        }
        return Pair(abs(area) / 2f, per)
    }

    /** Rotating calipers over the hull: min-area enclosing rotated rectangle. */
    fun minAreaRect(hull: List<Pair<Float, Float>>): Triple<Pair<Float, Float>, Pair<Float, Float>, Float> {
        var best = Triple(Pair(0f, 0f), Pair(1e9f, 1e9f), 0f)
        var bestArea = Float.MAX_VALUE
        for (i in hull.indices) {
            val a = hull[i]
            val b = hull[(i + 1) % hull.size]
            val dx = b.first - a.first
            val dy = b.second - a.second
            val len = sqrt(dx * dx + dy * dy).coerceAtLeast(1e-6f)
            val ux = dx / len; val uy = dy / len
            var minU = Float.MAX_VALUE; var maxU = -Float.MAX_VALUE
            var minV = Float.MAX_VALUE; var maxV = -Float.MAX_VALUE
            for (p in hull) {
                val u = (p.first - a.first) * ux + (p.second - a.second) * uy
                val v = -(p.first - a.first) * uy + (p.second - a.second) * ux
                if (u < minU) minU = u
                if (u > maxU) maxU = u
                if (v < minV) minV = v
                if (v > maxV) maxV = v
            }
            val area = (maxU - minU) * (maxV - minV)
            if (area < bestArea) {
                bestArea = area
                val cu = (minU + maxU) / 2f
                val cv = (minV + maxV) / 2f
                val cx = a.first + ux * cu - uy * cv
                val cy = a.second + uy * cu + ux * cv
                best = Triple(Pair(cx, cy), Pair(maxU - minU, maxV - minV), atan2(uy, ux))
            }
        }
        return best
    }

    /** Crop an axis-aligned rect from a bitmap. */
    fun crop(bmp: Bitmap, x: Float, y: Float, w: Float, h: Float): Bitmap {
        val l = max(0f, x).toInt()
        val t = max(0f, y).toInt()
        val r = min(bmp.width.toFloat(), x + w).toInt()
        val b = min(bmp.height.toFloat(), y + h).toInt()
        if (r - l <= 1 || b - t <= 1) return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        return Bitmap.createBitmap(bmp, l, t, r - l, b - t)
    }

    /** Perspective-correct-ish rotation crop: rotate around the box center, then crop. */
    fun rotatedCrop(src: Bitmap, box: Box): Bitmap {
        val w = max(2, box.w.toInt())
        val h = max(2, box.h.toInt())
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val paint = Paint(Paint.FILTER_BITMAP_FLAG)
        canvas.save()
        canvas.translate(w / 2f, h / 2f)
        canvas.rotate(-Math.toDegrees(box.angleRad.toDouble()).toFloat())
        canvas.translate(-box.x, -box.y)
        canvas.drawBitmap(src, 0f, 0f, paint)
        canvas.restore()
        return out
    }

    /** Grayscale conversion (used before resizing into the recognition net). */
    fun grayscale(src: Bitmap): Bitmap {
        val out = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        val paint = Paint()
        val cm = ColorMatrix().apply { setSaturation(0f) }
        paint.colorFilter = ColorMatrixColorFilter(cm)
        c.drawBitmap(src, 0f, 0f, paint)
        return out
    }

    /** CTC greedy decode over [T, C] logits with a label dictionary. */
    fun ctcGreedyDecode(logits: FloatArray, seqLen: Int, numClasses: Int, dict: List<String>, useSpace: Boolean): Pair<String, Float> {
        val sb = StringBuilder()
        var conf = 0f
        var count = 0
        var prev = -1
        for (t in 0 until seqLen) {
            var best = 0
            var bestVal = -Float.MAX_VALUE
            for (c in 0 until numClasses) {
                val v = logits[t * numClasses + c]
                if (v > bestVal) { bestVal = v; best = c }
            }
            // softmax confidence of the winning class
            var sum = 0f
            for (c in 0 until numClasses) sum += kotlin.math.exp(logits[t * numClasses + c] - bestVal)
            val p = 1f / sum
            if (best != 0 && best != prev) {
                val label = dict.getOrNull(best - 1) ?: ""
                sb.append(label)
                conf += p; count++
            }
            prev = best
        }
        if (useSpace && sb.isNotEmpty()) {
            // PaddleOCR dictionaries with `use_space_char` append a space class; kept
            // transparent here because the shipped dicts include it as the last entry.
        }
        val text = sb.toString()
        return Pair(text, if (count == 0) 0f else conf / count)
    }
}
