package eu.kanade.tachiyomi.extension.en.comix

import keiyoushi.network.get
import okhttp3.CacheControl
import okhttp3.Headers
import okhttp3.OkHttpClient
import java.io.IOException

internal class WebPage private constructor(
    val url: String,
    val html: String,
    val userAgent: String,
) {
    companion object {
        // Let the app's Cloudflare handler and cookie jar run before rendering HTML.
        suspend fun fetch(client: OkHttpClient, url: String, headers: Headers): WebPage = client.get(url, headers, cacheControl = CacheControl.FORCE_NETWORK, ensureSuccess = false).use { response ->
            // Only reached if the host's handler returned an unresolved challenge.
            if (response.header("cf-mitigated").equals("challenge", ignoreCase = true)) {
                throw IOException("Cloudflare verification required. Open in WebView, complete the check, then refresh.")
            }
            if (!response.isSuccessful) {
                throw IOException("Comix returned HTTP ${response.code}. Open in WebView to check the site.")
            }
            WebPage(
                response.request.url.toString(),
                response.body.string(),
                response.request.header("User-Agent") ?: headers["User-Agent"].orEmpty(),
            )
        }
    }
}
