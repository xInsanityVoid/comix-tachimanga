package eu.kanade.tachiyomi.extension.en.comix

// Match only the bare WebKit UA from the blocked session; preserve all other app/user choices.
internal fun comixUserAgent(userAgent: String): String = when (userAgent) {
    BARE_IPHONE_USER_AGENT -> SAFARI_IPHONE_USER_AGENT
    else -> userAgent
}

private const val BARE_IPHONE_USER_AGENT =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 " +
        "(KHTML, like Gecko) Mobile/15E148"

private const val SAFARI_IPHONE_USER_AGENT =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 " +
        "(KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1"
