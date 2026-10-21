package eu.kanade.tachiyomi.extension.en.comix

fun main() {
    val observedWebKit = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) " +
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
    val confirmedSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) " +
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1"
    check(comixUserAgent(observedWebKit) == confirmedSafari) { "Observed WebKit identity must use the confirmed Safari identity" }

    val unchanged = listOf(
        "confirmed Safari" to confirmedSafari,
        "different Safari version" to confirmedSafari.replace("Version/26.4", "Version/26.3"),
        "Android browser" to "Mozilla/5.0 (Linux; Android 15; Test) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
        "custom user agent" to "CustomReader/1.0",
        "different iPhone OS" to observedWebKit.replace("18_7", "18_6"),
        "different WebKit version" to observedWebKit.replace("605.1.15", "605.1.14"),
        "different mobile build" to observedWebKit.replace("15E148", "15E149"),
        "iPad" to observedWebKit.replace("iPhone; CPU iPhone", "iPad; CPU"),
        "leading whitespace" to " $observedWebKit",
        "trailing whitespace" to "$observedWebKit ",
        "empty value" to "",
    )
    for ((name, value) in unchanged) {
        check(comixUserAgent(value) == value) { "User agent must stay unchanged: $name" }
    }
    println("Comix user-agent mapping: ${unchanged.size + 1} cases passed")
}
