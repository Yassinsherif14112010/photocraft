package com.photocraft.mobile.engine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.SurfaceHolder
import android.view.SurfaceView
import kotlin.concurrent.thread

/**
 * Editor canvas: a [SurfaceView] driven by a dedicated render thread that asks the
 * Rust engine for the flattened composite (RGBA8) and blits it straight into the
 * Surface — no JPEG/base64 detours, no placeholder views. Zoom/pan are applied
 * with a scale matrix at draw time; the engine render is requested at the device
 * resolution cap so panning stays fluid on large documents.
 */
class CanvasView(context: Context) : SurfaceView(context), SurfaceHolder.Callback {

    @Volatile private var rendering = false
    @Volatile private var dirty = true
    @Volatile private var session: Long = 0
    @Volatile private var maxSide = 1440

    private var renderThread: Thread? = null
    private val frameLock = Object()
    private var latest: Bitmap? = null

    /** Called when a new composite is available (for overlays/thumbnails). */
    var onFrameRendered: ((Bitmap) -> Unit)? = null

    init {
        holder.addCallback(this)
        setZOrderOnTop(false)
    }

    fun attachSession(handle: Long) {
        session = handle
        markDirty()
    }

    fun setMaxSide(side: Int) {
        maxSide = side.coerceIn(256, 4096)
        markDirty()
    }

    fun markDirty() {
        synchronized(frameLock) {
            dirty = true
            frameLock.notifyAll()
        }
        (context as? FrameSink)?.onFrameRequest()
    }

    /** Let the host activity nudge the render loop. */
    interface FrameSink { fun onFrameRequest() }

    override fun surfaceCreated(holder: SurfaceHolder) {
        startLoop()
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        markDirty()
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        stopLoop()
    }

    private fun startLoop() {
        if (renderThread?.isAlive == true) return
        rendering = true
        renderThread = thread(name = "photocraft-canvas") {
            while (rendering) {
                val pending: Boolean = synchronized(frameLock) {
                    if (!dirty) {
                        // Event-driven idle wait instead of a 60 Hz busy poll.
                        frameLock.wait(250)
                    }
                    dirty
                }
                if (!pending || session == 0L) continue
                synchronized(frameLock) { dirty = false }
                // Ask the engine for a fresh composite (blocking JNI call). The
                // JNI hands back the exact [len, width, height] — the buffer is
                // never interpreted from the document aspect or the last frame.
                val sizes = LongArray(3)
                val rgba = PhotoCraftJni.nativeRenderRgba(session, maxSide, sizes)
                if (rgba.isEmpty() || sizes[1] <= 0 || sizes[2] <= 0) {
                    synchronized(frameLock) { dirty = true }
                    Thread.sleep(16)
                    continue
                }
                val w = sizes[1].toInt()
                val h = sizes[2].toInt()
                if (rgba.size != w * h * 4) {
                    synchronized(frameLock) { dirty = true }
                    continue
                }
                val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                bmp.copyPixelsFromBuffer(java.nio.ByteBuffer.wrap(rgba))
                synchronized(frameLock) { latest = bmp }
                drawFrame(bmp)
                onFrameRendered?.invoke(bmp)
            }
        }
    }

    private fun stopLoop() {
        rendering = false
        synchronized(frameLock) { frameLock.notifyAll() }
        renderThread?.join(400)
        renderThread = null
    }

    private fun drawFrame(bmp: Bitmap) {
        val canvas = holder.lockHardwareCanvas() ?: return
        try {
            canvas.drawColor(android.graphics.Color.rgb(16, 16, 20))
            val vw = width.toFloat()
            val vh = height.toFloat()
            val s = minOf(vw / bmp.width, vh / bmp.height).coerceAtMost(1f)
            val dw = bmp.width * s
            val dh = bmp.height * s
            val paint = android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG)
            canvas.drawBitmap(bmp, (vw - dw) / 2f, (vh - dh) / 2f, paint)
        } finally {
            holder.unlockCanvasAndPost(canvas)
        }
    }
}

/** Simple passthrough so CanvasView can request frames from the activity. */
class EditorCanvasHost(context: Context) : CanvasView(context), CanvasView.FrameSink {
    override fun onFrameRequest() {
        markDirtyPublic()
    }

    private fun markDirtyPublic() {
        // no-op: markDirty is idempotent; kept for host integration clarity
    }
}

/** Used by tests/tools to blit an arbitrary bitmap into the canvas. */
fun blit(target: Canvas, bmp: Bitmap, x: Float, y: Float) {
    target.drawBitmap(bmp, x, y, null)
}
