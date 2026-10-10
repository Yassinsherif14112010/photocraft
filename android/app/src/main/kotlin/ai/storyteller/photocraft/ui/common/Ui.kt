package ai.storyteller.photocraft.ui.common

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.View
import android.widget.Toast
import androidx.annotation.StringRes
import com.google.android.material.snackbar.Snackbar
import java.text.DecimalFormat
import java.util.Locale
import kotlin.math.abs

// ---- messages -------------------------------------------------------------

fun View.snack(message: CharSequence, long: Boolean = false) =
    Snackbar.make(this, message, if (long) Snackbar.LENGTH_LONG else Snackbar.LENGTH_SHORT).show()

fun View.snack(@StringRes message: Int, long: Boolean = false) =
    Snackbar.make(this, message, if (long) Snackbar.LENGTH_LONG else Snackbar.LENGTH_SHORT).show()

fun Context.toast(message: CharSequence) =
    Toast.makeText(this, message, Toast.LENGTH_SHORT).show()

// ---- formatting -----------------------------------------------------------

private val sizeFormat = DecimalFormat("#,##0.#")

/** "4.7 MB", "820 kB" — uses the current locale's digits. */
fun formatBytes(bytes: Long, locale: Locale = Locale.getDefault()): String {
    if (bytes <= 0) return "0"
    val units = arrayOf("B", "kB", "MB", "GB")
    var value = bytes.toDouble()
    var unit = 0
    while (value >= 1000 && unit < units.lastIndex) {
        value /= 1000.0
        unit++
    }
    val number = if (value < 10) DecimalFormat("#,##0.#").format(value) else DecimalFormat("#,##0").format(value)
    return "$number ${units[unit]}"
}

fun formatPixels(px: Int): String = sizeFormat.format(px.toLong())

fun formatMegapixels(width: Int, height: Int): String =
    "${DecimalFormat("0.#").format(width.toDouble() * height.toDouble() / 1_000_000.0)} MP"

/** "just now", "12 min ago", "3 h ago", or a date for anything older than a week. */
fun Context.relativeTime(timestamp: Long): String {
    if (timestamp <= 0) return ""
    val diff = System.currentTimeMillis() - timestamp
    val minutes = diff / 60_000L
    return when {
        minutes < 1 -> getString(R.string.relative_now)
        minutes < 60 -> getString(R.string.relative_minutes, minutes.toInt())
        minutes < 60 * 24 -> getString(R.string.relative_hours, (minutes / 60).toInt())
        minutes < 60 * 24 * 7 -> getString(R.string.relative_days, (minutes / (60 * 24)).toInt())
        else -> android.text.format.DateFormat.getMediumDateFormat(this).format(java.util.Date(timestamp))
    }
}

/** `#RRGGBB` parsing that never throws: a bad value falls back to [fallback]. */
fun parseColorOr(hex: String, fallback: Int = Color.WHITE): Int {
    val cleaned = hex.trim().removePrefix("#")
    return runCatching {
        when (cleaned.length) {
            6 -> Color.parseColor("#$cleaned")
            8 -> Color.parseColor("#$cleaned")
            3 -> Color.parseColor(
                "#${cleaned[0]}${cleaned[0]}${cleaned[1]}${cleaned[1]}${cleaned[2]}${cleaned[2]}"
            )
            else -> fallback
        }
    }.getOrDefault(fallback)
}

fun Int.toHex(): String = String.format(Locale.US, "#%06X", 0xFFFFFF and this)

// ---- canvases -------------------------------------------------------------

/**
 * The transparency checkerboard a document canvas needs: without it a removed background is
 * indistinguishable from a white one.
 */
fun transparencyCheckerboard(tile: Int = 24, light: Int, dark: Int): Bitmap {
    val bitmap = Bitmap.createBitmap(tile * 2, tile * 2, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.color = light
    canvas.drawColor(light)
    paint.color = dark
    canvas.drawRect(0f, 0f, tile.toFloat(), tile.toFloat(), paint)
    canvas.drawRect(tile.toFloat(), tile.toFloat(), (tile * 2).toFloat(), (tile * 2).toFloat(), paint)
    return bitmap
}

/** True when the two sizes differ by more than half a pixel: used to avoid needless re-renders. */
fun sizeChanged(a: Bitmap?, width: Int, height: Int): Boolean =
    a == null || abs(a.width - width) > 0 || abs(a.height - height) > 0

/** Runs [block] and reports the exception to the caller instead of crashing. */
inline fun <T> attempt(block: () -> T): Result<T> = runCatching(block)
