package eu.kanade.tachiyomi.extension.en.comix

import eu.kanade.tachiyomi.source.model.Page
import keiyoushi.utils.NativeWebViewApi
import keiyoushi.utils.WebViewTimeoutException
import keiyoushi.utils.parseAs
import keiyoushi.utils.runWebView
import kotlinx.serialization.Serializable
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

internal object Reader {
    private val snapshotScript by lazy { asset("reader_snapshot.js") }
    private val captureScript by lazy { asset("chapter_pages.js") }

    @OptIn(NativeWebViewApi::class)
    suspend fun pages(page: WebPage, chapterId: Int): List<Page> {
        val stateName = "comixReader" + UUID.randomUUID().toString().replace("-", "")
        val script = """
            (() => {
                try {
                    const state = window.$stateName || (window.$stateName = {});
                    return JSON.stringify(($captureScript)($snapshotScript, $chapterId, state));
                } catch (error) {
                    return JSON.stringify({status: "error", stage: "script", error: String(error)});
                }
            })()
        """.trimIndent()
        var stage = "loading the chapter document"
        val snapshot = try {
            runWebView<Snapshot>(timeout = 18.seconds) {
                userAgent = page.userAgent
                // Let the site's reader load normally, including its image and script hosts.
                blockImages = false
                withNativeWebView { it.settings.setSupportMultipleWindows(true) }
                onReceivedError { request, error ->
                    if (request.isForMainFrame) {
                        reject(Exception("Comix reader v58: ${error.description}"))
                    }
                }
                val evaluating = AtomicBoolean()
                poll(150.milliseconds) {
                    if (!evaluating.compareAndSet(false, true)) return@poll
                    evaluateJs(script) { value ->
                        evaluating.set(false)
                        if (value == "null") return@evaluateJs
                        val result = runCatching { value.parseAs<String>().parseAs<Snapshot>() }
                            .getOrElse {
                                reject(Exception("Comix reader v58: could not read the WebView result", it))
                                return@evaluateJs
                            }
                        stage = result.stage
                        when (result.status) {
                            "ready" -> resolve(result)
                            "error" -> reject(Exception("Comix reader v58: ${result.error ?: result.stage}"))
                            "waiting" -> Unit
                            else -> reject(Exception("Comix reader v58: unexpected reader state"))
                        }
                    }
                }
                loadData(page.url, page.html)
            }
        } catch (_: WebViewTimeoutException) {
            throw Exception("Comix reader v58: $stage did not finish within 18 seconds")
        }
        val images = snapshot.items ?: throw Exception("Comix reader v58: missing images")
        check(snapshot.count == images.size && images.isNotEmpty()) { "Comix reader v58: incomplete chapter" }
        return images.mapIndexed { index, image ->
            check(image.number == index + 1 && image.url.toHttpUrlOrNull() != null) { "Comix reader v58: invalid page ${index + 1}" }
            Page(index, imageUrl = image.url)
        }
    }

    private fun asset(name: String) = Reader::class.java.getResource("/assets/$name")!!.readText()

    @Serializable
    private class Snapshot(
        val status: String,
        val stage: String,
        val count: Int? = null,
        val items: List<Image>? = null,
        val error: String? = null,
    )

    @Serializable
    private class Image(
        val number: Int,
        val url: String,
    )
}
