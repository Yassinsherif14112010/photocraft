package ai.storyteller.photocraft.ui.common

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.graphics.Rect
import android.os.Build
import android.util.DisplayMetrics
import androidx.window.layout.WindowMetricsCalculator

/**
 * Window size classes, computed from the **real** window the app was given — not from a device
 * model list and not from resources only.
 *
 * `WindowMetricsCalculator` (androidx.window) reports the current window: on a foldable it changes
 * when the device folds or unfolds, in split-screen it is half the screen, and on a desktop
 * windowing session it is the free-form window. Layouts react to it, so the same build serves a
 * phone in portrait, a tablet in landscape and an unfolded foldable.
 */
enum class WidthClass { COMPACT, MEDIUM, EXPANDED }

enum class HeightClass { COMPACT, MEDIUM, EXPANDED }

data class WindowSizeClass(
    val width: WidthClass,
    val height: HeightClass,
    /** Window width in dp (the value the Material breakpoints are defined on). */
    val widthDp: Int,
    val heightDp: Int,
    /** True when the window is at least 600 dp wide: the classic "tablet / two-pane" break. */
    val isTabletLike: Boolean
) {
    /** True when a side panel fits next to the canvas. */
    val supportsSidePanel: Boolean get() = width != WidthClass.COMPACT

    val isLandscape: Boolean get() = widthDp > heightDp
}

fun Activity.windowSizeClass(): WindowSizeClass {
    val metrics = runCatching { WindowMetricsCalculator.getOrCreate().computeCurrentWindowMetrics(this) }
        .getOrNull()
    val bounds: Rect = metrics?.bounds ?: run {
        val dm = DisplayMetrics()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            display?.getRealMetrics(dm)
        } else {
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay.getMetrics(dm)
        }
        Rect(0, 0, dm.widthPixels, dm.heightPixels)
    }
    val density = resources.displayMetrics.density.coerceAtLeast(0.5f)
    val widthDp = (bounds.width() / density).toInt()
    val heightDp = (bounds.height() / density).toInt()
    return WindowSizeClass(
        width = when {
            widthDp < 600 -> WidthClass.COMPACT
            widthDp < 840 -> WidthClass.MEDIUM
            else -> WidthClass.EXPANDED
        },
        height = when {
            heightDp < 480 -> HeightClass.COMPACT
            heightDp < 900 -> HeightClass.MEDIUM
            else -> HeightClass.EXPANDED
        },
        widthDp = widthDp,
        heightDp = heightDp,
        isTabletLike = widthDp >= 600
    )
}

/**
 * Grid span count for the window, read from `integers.xml` per size class. The values are
 * resources, so a tablet gets more columns without a code change on a different device.
 */
fun gridSpan(context: Context, sizeClass: WindowSizeClass, assetGrid: Boolean = false): Int {
    val res = context.resources
    return when (sizeClass.width) {
        WidthClass.COMPACT -> res.getInteger(
            if (assetGrid) R.integer.grid_span_asset_compact else R.integer.grid_span_compact
        )
        WidthClass.MEDIUM -> res.getInteger(
            if (assetGrid) R.integer.grid_span_asset_medium else R.integer.grid_span_medium
        )
        WidthClass.EXPANDED -> res.getInteger(
            if (assetGrid) R.integer.grid_span_asset_expanded else R.integer.grid_span_expanded
        )
    }
}

/** True when the layout direction is RTL (Arabic, Hebrew). */
fun Context.isRtl(): Boolean =
    resources.configuration.layoutDirection == android.view.View.LAYOUT_DIRECTION_RTL

/** True when the device is a foldable that is currently open (or a very wide window). */
fun Activity.isUnfolded(): Boolean = windowSizeClass().width != WidthClass.COMPACT

fun Context.isLandscape(): Boolean =
    resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
