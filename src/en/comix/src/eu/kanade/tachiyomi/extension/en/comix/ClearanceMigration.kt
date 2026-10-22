package eu.kanade.tachiyomi.extension.en.comix

import android.content.SharedPreferences
import android.webkit.CookieManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.io.IOException

internal class ClearanceMigration(
    private val preferences: SharedPreferences,
    private val cookieJar: CookieJar,
) {
    private val mutex = Mutex()

    suspend fun run(userAgent: String) = mutex.withLock {
        if (!(userAgent.contains("iPhone") || userAgent.contains("iPad"))) return@withLock
        if (preferences.getBoolean(KEY, false)) return@withLock

        withContext(Dispatchers.Main) {
            val manager = CookieManager.getInstance()
            // The exported pre-migration clearance reproduces a 503 by itself. Expire it
            // once in both stores, retaining login cookies and any newly issued clearance.
            val urls = listOf("https://comix.to/", "https://comix.ws/").map { it.toHttpUrl() }
            for (url in urls) {
                val expired = listOf(false, true).map { hostOnly ->
                    Cookie.Builder().name(NAME).value("").path("/").secure().httpOnly().expiresAt(0)
                        .apply { if (hostOnly) hostOnlyDomain(url.host) else domain(url.host) }
                        .build()
                }
                cookieJar.saveFromResponse(url, expired)
                expired.forEach { manager.setCookie(url.toString(), it.toString()) }
            }
            val cleared = withTimeoutOrNull(2000L) {
                while (urls.any { url ->
                        hasClearance(manager.getCookie(url.toString())) ||
                            cookieJar.loadForRequest(url).any { it.name == NAME }
                    }
                ) {
                    delay(50L)
                }
                true
            } == true
            if (!cleared) throw IOException("Comix: the app retained the old clearance cookie after removal")
            manager.flush()
            preferences.edit().putBoolean(KEY, true).apply()
        }
    }

    private fun hasClearance(header: String?): Boolean = header.orEmpty().split(';').any {
        val cookie = it.trim()
        cookie.substringBefore('=') == NAME
    }

    private companion object {
        const val KEY = "clearance_migration_72"
        const val NAME = "cf_clearance"
    }
}
