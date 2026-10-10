package ai.storyteller.photocraft.ui.editor

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Shader
import android.util.AttributeSet
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import ai.storyteller.photocraft.R
import ai.storyteller.photocraft.ui.common.transparencyCheckerboard
import kotlin.math.max
import kotlin.math.min

/**
 * The document canvas.
 *
 * It shows the bitmap the engine composited — never a placeholder — over a transparency
 * checkerboard, with pinch-to-zoom, drag-to-pan, double-tap-to-fit and stylus support. The view
 * only ever *displays* the document: panning and zooming are view state, so zooming in never
 * modifies, resamples or flattens anything in the engine.
 */
class CanvasView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyle: Int = 0
) : View(context, attrs, defStyle) {

    /** The composite from the engine, replaced (and the old one recycled) on every refresh. */
    private var bitmap: Bitmap? = null

    private val matrix = Matrix()
    private val inverse = Matrix()

    /** Scale that fits the whole document in the view, recomputed on every size change. */
    private var fitScale = 1f

    private var baseScale = 1f
    private var userScale = 1f
    private var translateX = 0f
    private var translateY = 0f

    private var checker: Bitmap? = null
    private val checkerPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val imagePaint = Paint(Paint.FILTER_BITMAP_FLAG)

    /** Stylus pressure reported to the editor (0..1); 0 for touch. */
    var lastPressure: Float = 0f
        private set

    var stylusInUse: Boolean = false
        private set

    private val scaleListener = object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            userScale = (userScale * detector.scaleFactor).coerceIn(MIN_SCALE_FACTOR, MAX_SCALE_FACTOR)
            applyTransform()
            invalidate()
            return true
        }
    }

    private val gestureListener = object : GestureDetector.SimpleOnGestureListener() {
        override fun onDoubleTap(e: MotionEvent): Boolean {
            fitToScreen()
            return true
        }

        override fun onScroll(
            e1: MotionEvent?,
            e2: MotionEvent,
            distanceX: Float,
            distanceY: Float
        ): Boolean {
            translateX -= distanceX
            translateY -= distanceY
            clampPan()
            applyTransform()
            invalidate()
            return true
        }
    }

    private val scaleDetector = ScaleGestureDetector(context, scaleListener)
    private val gestureDetector = GestureDetector(context, gestureListener)

    init {
        isFocusable = true
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
        contentDescription = resources.getString(R.string.a11y_canvas)
    }

    /**
     * Shows a new composite. The previous bitmap is recycled only after the new one is installed,
     * so the canvas is never blank while rendering.
     */
    fun setDocument(next: Bitmap, keepViewTransform: Boolean = true) {
        val previous = bitmap
        bitmap = next
        if (!keepViewTransform) {
            fitScale = 0f
        }
        requestLayout()
        invalidate()
        previous?.recycle()
    }

    /** Re-centres and re-fits the document (after a rotation, a crop or "fit to screen"). */
    fun fitToScreen() {
        val bmp = bitmap ?: return
        fitScale = 0f
        baseScale = 1f
        userScale = 1f
        translateX = 0f
        translateY = 0f
        recomputeFit(bmp)
        applyTransform()
        invalidate()
    }

    /** The zoom factor relative to "fit": 1.0 shows the whole document. */
    val zoom: Float get() = userScale

    /** Document coordinates of a view point, for taps the editor translates into edits. */
    fun toDocumentPoint(viewX: Float, viewY: Float): Pair<Int, Int> {
        inverse.set(matrix)
        val point = floatArrayOf(viewX, viewY)
        val inverted = Matrix()
        matrix.invert(inverted)
        inverted.mapPoints(point)
        return point[0].toInt() to point[1].toInt()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        bitmap?.let { recomputeFit(it) }
        applyTransform()
    }

    private fun recomputeFit(bmp: Bitmap) {
        if (width == 0 || height == 0) return
        val scale = min(width.toFloat() / bmp.width.toFloat(), height.toFloat() / bmp.height.toFloat())
        fitScale = scale * FIT_MARGIN
        baseScale = if (fitScale > 0f) fitScale else 1f
        centerBitmap(bmp)
    }

    private fun centerBitmap(bmp: Bitmap) {
        val scale = baseScale * userScale
        val scaledW = bmp.width * scale
        val scaledH = bmp.height * scale
        translateX = (width - scaledW) / 2f
        translateY = (height - scaledH) / 2f
    }

    private fun clampPan() {
        val bmp = bitmap ?: return
        val scale = baseScale * userScale
        val scaledW = bmp.width * scale
        val scaledH = bmp.height * scale
        // Allow a quarter of the view of overscroll so the edges of a large document are reachable.
        val slackX = max(0f, (scaledW - width) / 2f) + width * OVERSCROLL
        val slackY = max(0f, (scaledH - height) / 2f) + height * OVERSCROLL
        translateX = translateX.coerceIn(-slackX, slackX)
        translateY = translateY.coerceIn(-slackY, slackY)
    }

    private fun applyTransform() {
        val bmp = bitmap ?: return
        if (fitScale <= 0f) recomputeFit(bmp)
        matrix.reset()
        matrix.postScale(baseScale * userScale, baseScale * userScale)
        matrix.postTranslate(translateX, translateY)
        matrix.invert(inverse)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val bmp = bitmap
        if (bmp == null) {
            canvas.drawColor(context.getColor(R.color.pc_canvas_backdrop))
            return
        }
        if (fitScale <= 0f) recomputeFit(bmp)

        // Checkerboard behind the document, drawn in document space so it moves and zooms with it.
        val tile = checker ?: transparencyCheckerboard(
            tile = 24,
            light = context.getColor(R.color.pc_canvas_checker_light),
            dark = context.getColor(R.color.pc_canvas_checker_dark)
        ).also { checker = it }
        val shader: Shader = BitmapShader(tile, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT)
        checkerPaint.shader = shader
        canvas.save()
        canvas.concat(matrix)
        canvas.drawRect(0f, 0f, bmp.width.toFloat(), bmp.height.toFloat(), checkerPaint)
        canvas.drawBitmap(bmp, 0f, 0f, imagePaint)
        canvas.restore()
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        stylusInUse = event.getToolType(0) == MotionEvent.TOOL_TYPE_STYLUS
        lastPressure = if (stylusInUse) event.pressure.coerceIn(0f, 1f) else 0f
        scaleDetector.onTouchEvent(event)
        val handled = gestureDetector.onTouchEvent(event)
        if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
            performClick()
        }
        return handled || super.onTouchEvent(event)
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    /** Frees the composite when the activity goes away. */
    fun release() {
        bitmap?.recycle()
        bitmap = null
        checker?.recycle()
        checker = null
        invalidate()
    }

    companion object {
        private const val FIT_MARGIN = 0.92f
        private const val MIN_SCALE_FACTOR = 1f
        private const val MAX_SCALE_FACTOR = 32f
        private const val OVERSCROLL = 0.25f
    }
}
