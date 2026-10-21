package eu.kanade.tachiyomi.extension.en.comix

internal class TouchInput private constructor(val viewportWidth: Float, val points: List<Float>) {
    companion object {
        fun parse(message: String): TouchInput {
            val values = message.split(',').map { it.toFloatOrNull() }
            require(values.size == 3 || values.size == 5) { "Comix63: invalid touch message" }
            require(values.all { it != null && it.isFinite() }) { "Comix63: invalid touch coordinates" }
            val width = values.first()!!
            require(width > 0) { "Comix63: missing browser viewport width" }
            return TouchInput(width, values.drop(1).map { it!! })
        }
    }
}

internal fun touchScale(viewportWidth: Float, nativeWidth: Int): Float {
    require(viewportWidth.isFinite() && viewportWidth > 0 && nativeWidth > 0) {
        "Comix63: WebView width unavailable for touch input"
    }
    return nativeWidth / viewportWidth
}
