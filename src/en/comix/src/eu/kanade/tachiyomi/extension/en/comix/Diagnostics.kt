package eu.kanade.tachiyomi.extension.en.comix

import java.io.IOException

// Keep unexpected host/runtime null failures distinguishable from site responses.
internal suspend fun <T> comixStep(stage: String, block: suspend () -> T): T = try {
    block()
} catch (error: NullPointerException) {
    throw nullFailure(stage, error)
}

internal fun nullFailure(stage: String, error: NullPointerException): IOException {
    val location = error.stackTrace.take(3).joinToString(" > ") {
        "${it.className.substringAfterLast('.')}.${it.methodName}:${it.lineNumber}"
    }
    return IOException("Comix62 NPE [$stage] $location", error)
}

internal fun isHtmlRequest(headers: Map<String, String>?): Boolean = headers?.entries?.any {
    it.key.equals("Accept", ignoreCase = true) && it.value.contains("text/html", ignoreCase = true)
} == true
