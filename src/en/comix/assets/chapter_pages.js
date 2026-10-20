(snapshot, chapterId, state) => {
    const waiting = (stage) => ({ status: "waiting", stage });
    const read = snapshot(chapterId);
    if (read.status === "error") return read;

    // Restore the reader preferences after copying the complete, ordered URL list.
    if (state.result) {
        const preload = document.querySelector(`input[name="preload"][value="${state.preload}"]`);
        if (preload && !preload.checked) {
            preload.click();
            return waiting("restoring reader preload setting");
        }
        const progress = [...document.querySelectorAll('[aria-label="Progress bar position"] [role="radio"]')]
            .find((button) => button.getAttribute("aria-label") === state.progress);
        if (progress && progress.getAttribute("aria-checked") !== "true") {
            progress.click();
            return waiting("restoring reader progress setting");
        }
        if (state.opened) {
            document.querySelector('button[aria-label="Close settings"]')?.click();
            state.opened = false;
        }
        return state.result;
    }
    if (read.status === "ready") {
        if (state.preload) {
            state.result = read;
            return waiting("finishing chapter capture");
        }
        return read;
    }
    if (!document.querySelector(".rpage-main")) return read;

    const all = document.querySelector('input[name="preload"][value="all"]');
    if (!all) {
        if (!state.opened) {
            const settings = document.querySelector('button[aria-label="Settings"]');
            if (settings) {
                settings.click();
                state.opened = true;
            }
        }
        return waiting("opening reader settings");
    }
    if (!state.preload) {
        state.preload = document.querySelector('input[name="preload"]:checked')?.value;
        state.progress = document.querySelector('[aria-label="Progress bar position"] [aria-checked="true"]')
            ?.getAttribute("aria-label");
        if (!state.preload) return { status: "error", stage: "settings", error: "Reader preload setting is missing" };
    }
    if (!all.checked) {
        all.click();
        return waiting("enabling the reader's Preload all");
    }
    if (!document.querySelector(".rpage-progress__seg")) {
        document.querySelector('button[aria-label="Progress bar Left"]')?.click();
        return waiting("reading the complete page count");
    }
    return read;
}
