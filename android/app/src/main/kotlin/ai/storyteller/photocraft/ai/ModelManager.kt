package ai.storyteller.photocraft.ai

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.security.MessageDigest

/** What the models directory holds for one manifest entry. */
enum class ModelStatus { MISSING, VALID, CORRUPT }

/** Progress of a download. `total` is 0 when the server sends no Content-Length. */
data class DownloadProgress(val bytesRead: Long, val total: Long, val sourceUrl: String) {
    val percent: Int get() = if (total <= 0) -1 else (bytesRead * 100 / total).toInt().coerceIn(0, 100)
}

/**
 * Downloads, verifies and deletes the background-removal models.
 *
 * The rules are the same as in `scripts/fetch-models.sh`:
 *  * a download is resumed with an HTTP Range request and retried on failure;
 *  * the HTTP status is checked (redirects followed, 4xx/5xx is an error);
 *  * the exact size is checked when the manifest publishes one, the SHA-256 when it publishes one;
 *  * anything under [ModelSpec.minBytes] is rejected (an HTML error page is not a model);
 *  * a valid model is never downloaded twice.
 *
 * Nothing here runs on the main thread: every public function is a `suspend` on [Dispatchers.IO].
 */
class ModelManager(private val context: Context) {

    /** `<filesDir>/models` — the path the runtime looks models up in. */
    val modelsDir: File get() = File(context.filesDir, MODELS_DIR).apply { mkdirs() }

    /** The manifest bundled with the app (a copy of `scripts/models.conf`). */
    val specs: List<ModelSpec> by lazy {
        runCatching {
            context.assets.open(MANIFEST_ASSET).bufferedReader().use { ModelSpec.parse(it.readText()) }
        }.getOrDefault(emptyList())
    }

    fun fileFor(spec: ModelSpec): File = File(modelsDir, spec.file)

    fun status(spec: ModelSpec): ModelStatus {
        val file = fileFor(spec)
        if (!file.isFile) return ModelStatus.MISSING
        val size = file.length()
        if (spec.minBytes > 0 && size < spec.minBytes) return ModelStatus.CORRUPT
        if (spec.bytes > 0 && size != spec.bytes) return ModelStatus.CORRUPT
        val sha = spec.sha256
        if (sha != null && sha256(file) != sha) return ModelStatus.CORRUPT
        return ModelStatus.VALID
    }

    /**
     * Makes sure [spec] is on disk and valid.
     *
     * @param isCancelled polled between the network reads; when it turns true the download stops,
     *                    the partial file is kept for a later resume and `false` is returned.
     * @return true when a verified copy of the model is present.
     */
    suspend fun ensure(
        spec: ModelSpec,
        isCancelled: () -> Boolean = { false },
        onProgress: (DownloadProgress) -> Unit = {}
    ): Boolean = withContext(Dispatchers.IO) {
        if (status(spec) == ModelStatus.VALID) return@withContext true
        deletePartial(spec)

        for (source in spec.sources) {
            if (isCancelled()) return@withContext false
            if (download(spec, source, isCancelled, onProgress)) {
                val file = fileFor(spec)
                if (verify(spec, file)) return@withContext true
                // The copy did not verify: drop it so the next source starts clean.
                file.delete()
            }
        }
        false
    }

    /** Deletes a model and its partial download. */
    fun delete(spec: ModelSpec) {
        fileFor(spec).delete()
        deletePartial(spec)
    }

    /** Bytes used by all downloaded models, for Settings › Storage. */
    fun usedBytes(): Long = specs.sumOf { fileFor(it).takeIf { f -> f.isFile }?.length() ?: 0L }

    // ---- implementation -----------------------------------------------------

    private fun partialFile(spec: ModelSpec): File = File(modelsDir, "${spec.file}.part")

    private fun deletePartial(spec: ModelSpec) {
        partialFile(spec).delete()
        File(modelsDir, "${spec.file}.part.rejected").delete()
    }

    /** Downloads from one source with resume and retries. */
    private fun download(
        spec: ModelSpec,
        source: String,
        isCancelled: () -> Boolean,
        onProgress: (DownloadProgress) -> Unit
    ): Boolean {
        val target = partialFile(spec)
        for (attempt in 1..MAX_ATTEMPTS) {
            var connection: HttpURLConnection? = null
            try {
                val existing = if (target.isFile) target.length() else 0L
                connection = java.net.URL(source).openConnection() as HttpURLConnection
                connection.instanceFollowRedirects = true
                connection.connectTimeout = CONNECT_TIMEOUT_MS
                connection.readTimeout = READ_TIMEOUT_MS
                connection.setRequestProperty("User-Agent", "Photocraft-dev")
                if (existing > 0) connection.setRequestProperty("Range", "bytes=$existing-")

                val code = connection.responseCode
                when (code) {
                    HttpURLConnection.HTTP_OK -> target.delete()
                    HttpURLConnection.HTTP_PARTIAL -> Unit
                    else -> {
                        log("HTTP $code from $source")
                        connection.disconnect()
                        continue
                    }
                }

                val append = code == HttpURLConnection.HTTP_PARTIAL && existing > 0
                val contentLength = connection.getHeaderField("Content-Length")?.toLongOrNull() ?: 0L
                val total = if (append) existing + contentLength else contentLength

                connection.inputStream.use { input ->
                    RandomAccessFile(target, "rw").use { out ->
                        if (!append) out.setLength(0)
                        out.seek(if (append) existing else 0L)
                        val buffer = ByteArray(256 * 1024)
                        var read = if (append) existing else 0L
                        while (true) {
                            if (isCancelled()) return false
                            val n = input.read(buffer)
                            if (n <= 0) break
                            out.write(buffer, 0, n)
                            read += n
                            onProgress(DownloadProgress(read, total, source))
                        }
                    }
                }
                return true
            } catch (e: Exception) {
                log("download failed from $source (attempt $attempt): ${e.message}")
                Thread.sleep(RETRY_DELAY_MS)
            } finally {
                connection?.disconnect()
            }
        }
        return false
    }

    private fun verify(spec: ModelSpec, file: File): Boolean {
        if (!file.isFile) return false
        val size = file.length()
        if (spec.minBytes > 0 && size < spec.minBytes) {
            log("${spec.id}: $size bytes is below the ${spec.minBytes}-byte floor")
            return false
        }
        if (spec.bytes > 0 && size != spec.bytes) {
            log("${spec.id}: size $size, expected ${spec.bytes}")
            return false
        }
        val want = spec.sha256
        if (want != null) {
            val got = sha256(file)
            if (got != want) {
                log("${spec.id}: checksum $got, expected $want")
                return false
            }
        }
        return true
    }

    private fun sha256(file: File): String? = runCatching {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(1024 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n <= 0) break
                digest.update(buffer, 0, n)
            }
        }
        digest.digest().joinToString("") { "%02x".format(it) }
    }.getOrNull()

    private fun log(message: String) {
        android.util.Log.i(TAG, message)
    }

    companion object {
        const val MODELS_DIR = "models"
        const val MANIFEST_ASSET = "models.conf"
        private const val TAG = "ModelManager"
        private const val MAX_ATTEMPTS = 3
        private const val CONNECT_TIMEOUT_MS = 20_000
        private const val READ_TIMEOUT_MS = 60_000
        private const val RETRY_DELAY_MS = 2_000L
    }
}
