package eu.kanade.tachiyomi.extension.en.comix

import java.io.IOException

// Keep unexpected host/runtime null failures distinguishable from site responses.
internal suspend fun <T> comixStep(stage: String, block: suspend () -> T): T = try {
    block()
} catch (error: NullPointerException) {
    throw nullFailure(stage, error)
}

internal fun nullFailure(stage: String, error: NullPointerException): IOException {
    val location = error.stackTrace.take(3).joinToString("\n") {
        "${it.className}.${it.methodName}(${it.fileName ?: "unknown"}:${it.lineNumber})"
    }
    return IOException("Comix 1.6.60: $stage failed (NullPointerException)\n$location", error)
}
