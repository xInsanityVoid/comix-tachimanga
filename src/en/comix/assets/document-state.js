(passPayloadName) => {
    const ready = {
        loading: "LOADING",
        interactive: "INTERACTIVE",
        complete: "COMPLETE",
    }[document.readyState] || "UNKNOWN";
    let status = 0;
    try {
        const navigation = window.performance?.getEntriesByType?.("navigation")?.[0];
        if (Number.isInteger(navigation?.responseStatus) && navigation.responseStatus >= 100 && navigation.responseStatus <= 599) {
            status = navigation.responseStatus;
        }
    } catch (_) {}

    const initialData = Boolean(document.querySelector("script#initial-data"));
    const thirdPartyBlock = document.title === "Third-party apps are not supported";
    const cloudflareChallenge = document.title === "Just a moment..." ||
        document.title === "Just a moment…" ||
        Boolean(document.querySelector("#challenge-running, #challenge-form"));
    const kind = thirdPartyBlock ? "THIRD_PARTY_BLOCK" :
        cloudflareChallenge ? "CLOUDFLARE_CHALLENGE" :
        status === 503 ? "HTTP_503" :
        initialData ? "CONTENT" : "UNKNOWN";
    const scriptCount = document.scripts?.length;

    return JSON.stringify({
        ready,
        kind,
        status,
        body: Boolean(document.body),
        initialData,
        scripts: Number.isInteger(scriptCount) ? Math.min(10000, Math.max(0, scriptCount)) : 0,
        bridge: typeof window[passPayloadName] === "function",
        browsePayload: typeof window.__comixBrowsePayload === "string",
    });
}
