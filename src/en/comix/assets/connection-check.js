(configuredUa) => {
    const key = "__comixConnectionCheck";
    if (window[key]) return JSON.stringify(window[key]);

    const boundedUa = value => typeof value === "string" && value.length <= 512 && /^[\x20-\x7e]*$/.test(value) ? value : "";
    const runtimeUa = boundedUa(navigator.userAgent);
    const state = window[key] = {
        phase: "PENDING",
        runtimeUa,
        echoedUa: "",
        runtimeMatches: runtimeUa ? runtimeUa === configuredUa : null,
        echoedMatches: null,
        status: 0,
    };

    if (typeof fetch !== "function" || typeof AbortController !== "function") {
        state.phase = "UNAVAILABLE";
        return JSON.stringify(state);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
        state.phase = "TIMEOUT";
        controller.abort();
    }, 2000);
    // Same-origin echo: retain only the public UA, never IP, location or cookies.
    fetch("/cdn-cgi/trace", {
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
    }).then(async response => {
        if (state.phase !== "PENDING") return;
        state.status = response.status;
        if (!response.ok) {
            state.phase = "HTTP_ERROR";
            return;
        }
        const text = await response.text();
        if (state.phase !== "PENDING") return;
        const line = text.split(/\r?\n/).find(value => value.startsWith("uag="));
        state.echoedUa = boundedUa(line?.slice(4));
        state.echoedMatches = runtimeUa && state.echoedUa ? runtimeUa === state.echoedUa : null;
        state.phase = state.echoedUa ? "COMPLETE" : "NO_UA";
    }).catch(() => {
        if (state.phase === "PENDING") state.phase = "NETWORK_ERROR";
    }).finally(() => clearTimeout(timer));

    return JSON.stringify(state);
}
