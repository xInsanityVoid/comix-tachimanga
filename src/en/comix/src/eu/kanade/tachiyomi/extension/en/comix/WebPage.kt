package eu.kanade.tachiyomi.extension.en.comix

import keiyoushi.network.get
import okhttp3.CacheControl
import okhttp3.Headers
import okhttp3.OkHttpClient
import org.jsoup.Jsoup
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
            val html = response.body.string()
            if (Jsoup.parse(html).title().equals("Third-party apps are not supported", ignoreCase = true)) {
                throw IOException("Comix is blocking third-party apps for this session. Check the official site in WebView.")
            }
            if (!response.isSuccessful) {
                throw IOException("Comix returned HTTP ${response.code}. Open in WebView to check the site.")
            }
            WebPage(
                response.request.url.toString(),
                html,
                response.request.header("User-Agent") ?: headers["User-Agent"].orEmpty(),
            )
        }
    }
}
