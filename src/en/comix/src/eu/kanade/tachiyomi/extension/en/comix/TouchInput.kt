package eu.kanade.tachiyomi.extension.en.comix

internal class TouchInput private constructor(val viewportWidth: Float, val points: List<Float>) {
    companion object {
        fun parse(message: String): TouchInput {
            val values = message.split(',').map { it.toFloatOrNull() }
            require(values.size == 3 || values.size == 5) { "Comix62: invalid touch message" }
            require(values.all { it != null && it.isFinite() }) { "Comix62: invalid touch coordinates" }
            val width = values.first()!!
            require(width > 0) { "Comix62: missing browser viewport width" }
            return TouchInput(width, values.drop(1).map { it!! })
        }
    }
}

internal fun touchScale(viewportWidth: Float, nativeWidth: Int): Float {
    require(viewportWidth.isFinite() && viewportWidth > 0 && nativeWidth > 0) {
        "Comix62: WebView width unavailable for touch input"
    }
    return nativeWidth / viewportWidth
}
