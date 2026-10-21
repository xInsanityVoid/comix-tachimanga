package eu.kanade.tachiyomi.extension.en.comix

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.webkit.WebView
import keiyoushi.utils.NativeWebViewApi
import keiyoushi.utils.WebViewScope
import kotlin.math.pow
import kotlin.random.Random

/**
 * Swipes from ([fromX], [fromY]) to ([toX], [toY]) in CSS pixels the way a finger does: about half a second,
 * starting slowly and tailing off, with a fingertip's contact. Stops when the run ends.
 */
internal fun WebViewScope<*>.swipe(fromX: Float, fromY: Float, toX: Float, toY: Float, viewportWidth: Float) {
    val frames = Random.nextInt(25, 37)
    val finger = Finger(viewportWidth)
    val handler = Handler(Looper.getMainLooper())

    fun send(frame: Int) {
        val action = when (frame) {
            0 -> MotionEvent.ACTION_DOWN
            frames + 1 -> MotionEvent.ACTION_UP
            else -> MotionEvent.ACTION_MOVE
        }
        val progress = 1 - (1 - (frame.coerceAtMost(frames).toFloat() / frames).pow(1.6f)).pow(4)
        finger.send(this, action, fromX + (toX - fromX) * progress, fromY + (toY - fromY) * progress)
        if (frame <= frames) handler.postDelayed({ send(frame + 1) }, Random.nextLong(14, 19))
    }
    whenDrawn { send(0) }
}

/** Taps ([x], [y]) in CSS pixels the way a finger does: a short press that barely moves. */
internal fun WebViewScope<*>.tap(x: Float, y: Float, viewportWidth: Float) {
    val finger = Finger(viewportWidth)
    val handler = Handler(Looper.getMainLooper())
    val moves = Random.nextInt(0, 3)
    val stepMs = Random.nextLong(70, 130) / (moves + 1)

    fun send(frame: Int) {
        val action = when (frame) {
            0 -> MotionEvent.ACTION_DOWN
            moves + 1 -> MotionEvent.ACTION_UP
            else -> MotionEvent.ACTION_MOVE
        }

        // A pressed fingertip rolls a pixel or so
        fun roll() = if (action == MotionEvent.ACTION_MOVE) Random.nextDouble(-1.0, 1.0).toFloat() else 0f
        finger.send(this, action, x + roll(), y + roll())
        if (frame <= moves) handler.postDelayed({ send(frame + 1) }, stepMs)
    }
    whenDrawn { send(0) }
}

/** One fingertip's contact, sent to the WebView as touchscreen events. */
private class Finger(private val viewportWidth: Float) {
    private var downTime = 0L

    @OptIn(NativeWebViewApi::class)
    fun send(scope: WebViewScope<*>, action: Int, x: Float, y: Float) = scope.withNativeWebView { view ->
        try {
            // Match browser CSS coordinates to the actual host view, without Android Resources.
            val scale = touchScale(viewportWidth, view.width)
            if (action == MotionEvent.ACTION_DOWN) downTime = SystemClock.uptimeMillis()
            val event = MotionEvent.obtain(
                downTime,
                SystemClock.uptimeMillis(),
                action,
                x * scale,
                y * scale,
                0,
            )
            try {
                event.source = InputDevice.SOURCE_TOUCHSCREEN
                view.dispatchTouchEvent(event)
            } finally {
                event.recycle()
            }
        } catch (error: NullPointerException) {
            scope.reject(nullFailure("native touch event", error))
        }
    }
}

// Touches sent before the page has drawn are dropped, so wait up to a second for its next frame
@OptIn(NativeWebViewApi::class)
private fun WebViewScope<*>.whenDrawn(block: () -> Unit) = withNativeWebView { view ->
    try {
        val handler = Handler(Looper.getMainLooper())
        var started = false
        val start = Runnable {
            if (!started) {
                started = true
                block()
            }
        }
        handler.postDelayed(start, 1000)
        view.postVisualStateCallback(
            0,
            object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) {
                    handler.removeCallbacks(start)
                    start.run()
                }
            },
        )
    } catch (error: NullPointerException) {
        reject(nullFailure("native draw callback", error))
    }
}
