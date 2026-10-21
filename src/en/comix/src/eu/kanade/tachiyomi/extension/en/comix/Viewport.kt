package eu.kanade.tachiyomi.extension.en.comix

import android.view.View
import keiyoushi.utils.NativeWebViewApi
import keiyoushi.utils.WebViewScope

@OptIn(NativeWebViewApi::class)
internal fun WebViewScope<*>.configureViewport() = withNativeWebView { view ->
    try {
        // An intentional offscreen render surface, not an estimate of the device's display.
        // The shared setup depends on Android Resources, which Tachimanga can leave null.
        val width = 1080
        val height = 1920
        view.measure(
            View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
        )
        view.layout(0, 0, width, height)
        check(view.width > 0 && view.height > 0) {
            "Comix63: host did not size the WebView (${view.width}x${view.height})"
        }
    } catch (error: NullPointerException) {
        reject(nullFailure("viewport layout", error))
    }
}
