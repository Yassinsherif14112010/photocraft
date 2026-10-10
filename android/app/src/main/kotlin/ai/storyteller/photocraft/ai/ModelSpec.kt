package ai.storyteller.photocraft.ai

import java.util.Locale

/**
 * One entry of the model manifest.
 *
 * The manifest is a single file, `scripts/models.conf`, shipped to the device as an asset
 * (`android/app/src/main/assets/models.conf`). The download scripts and the app therefore always
 * agree on URLs, file names, sizes and checksums — `tools/check_models_conf.py` fails the build if
 * the copies drift apart.
 *
 * Fields: `id | label | tier | input | file | bytes | sha256 | min_bytes | url | mirrors`
 */
data class ModelSpec(
    val id: String,
    val label: String,
    val tier: Tier,
    /** Model input size in pixels (square), used when the ONNX graph declares a dynamic shape. */
    val inputSize: Int,
    val file: String,
    /** Exact size in bytes, 0 when the distributor publishes none. */
    val bytes: Long,
    /** Lowercase hex SHA-256, `null` when the distributor publishes none. */
    val sha256: String?,
    /** Sanity floor: anything smaller is a truncated download or an HTML error page. */
    val minBytes: Long,
    val url: String,
    val mirrors: List<String>
) {
    /** Primary URL first, then the mirrors in order. */
    val sources: List<String> get() = listOf(url) + mirrors

    enum class Tier { QUICK, BALANCED, HQ }

    companion object {

        /** Parses the manifest. Malformed lines are skipped: one bad line must not break setup. */
        fun parse(text: String): List<ModelSpec> = text.lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("#") }
            .mapNotNull { line ->
                val f = line.split('|')
                if (f.size < 10) return@mapNotNull null
                val tier = when (f[2].trim().lowercase(Locale.ROOT)) {
                    "quick" -> Tier.QUICK
                    "balanced" -> Tier.BALANCED
                    else -> Tier.HQ
                }
                val sha = f[6].trim().let { if (it.isEmpty() || it == "-") null else it.lowercase(Locale.ROOT) }
                runCatching {
                    ModelSpec(
                        id = f[0].trim(),
                        label = f[1].trim(),
                        tier = tier,
                        inputSize = f[3].trim().toIntOrNull()?.coerceIn(64, 4096) ?: 1024,
                        file = f[4].trim(),
                        bytes = f[5].trim().toLongOrNull() ?: 0L,
                        sha256 = sha,
                        minBytes = f[7].trim().toLongOrNull() ?: 0L,
                        url = f[8].trim(),
                        mirrors = f[9].split(';').map { it.trim() }.filter { it.startsWith("http") }
                    )
                }.getOrNull()
            }
            .toList()

        /** The model offered by default on this device class (phones get the small one). */
        fun defaultFor(specs: List<ModelSpec>, deviceIsTablet: Boolean): ModelSpec? =
            specs.firstOrNull { it.tier == Tier.QUICK }
                ?: specs.minByOrNull { it.minBytes }
    }
}
