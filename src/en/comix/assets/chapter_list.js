// Read the site's rendered chapter rows and operate its normal pagination controls.
(snapshot, knownIds, chapterPath, maxPages, touch, pass) => {
    const INPUT_TIMEOUT_MS = 2000;
    const MAX_TAPS = 3;
    const MAX_SWIPES = 15;
    const PAGE_TIMEOUT_MS = 25000;
    const chapters = [];
    const known = new Set(knownIds);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const between = (from, to) => from + Math.random() * (to - from);
    const section = () => document.querySelector(".mpage__chapters");
    const queries = () => {
        try { return JSON.parse(document.querySelector("script#initial-data")?.textContent || "null")?.queries || null; }
        catch { return null; }
    };
    const finish = (complete, error) => pass(JSON.stringify({ chapters, complete, error, queries: queries() }));
    // Resolves with the trusted event once the native input has reached the page
    const afterInput = (type, send) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            document.removeEventListener(type, done, true);
            reject(new Error(`The WebView didn't receive the ${type === "click" ? "tap" : "swipe"}`));
        }, INPUT_TIMEOUT_MS);
        function done(event) {
            if (!event.isTrusted) return;
            document.removeEventListener(type, done, true);
            clearTimeout(timer);
            setTimeout(() => resolve(event));
        }
        document.addEventListener(type, done, true);
        send();
    });

    // The site's first-visit ad: a fixed link over the whole page that takes the first tap
    const isAdOverlay = (element) => element && element.tagName === "A" &&
        getComputedStyle(element).position === "fixed" &&
        element.getBoundingClientRect().width >= document.documentElement.clientWidth &&
        element.getBoundingClientRect().height >= document.documentElement.clientHeight;

    // Swipes until the target is on screen
    const scrollTo = async (target) => {
        let lastTop = null;
        for (let i = 0; i < MAX_SWIPES; i++) {
            const rect = target.getBoundingClientRect();
            if (rect.top > innerHeight * 0.15 && rect.bottom < innerHeight * 0.85) return;
            // The page's end keeps it out of the middle band
            if (rect.top === lastTop && rect.top >= 0 && rect.bottom <= innerHeight) return;
            lastTop = rect.top;
            const x = innerWidth * between(0.3, 0.7);
            const down = rect.top > innerHeight / 2;
            const y = innerHeight * (down ? between(0.6, 0.75) : between(0.25, 0.4));
            const distance = Math.min(Math.abs(rect.top - innerHeight / 2), innerHeight * between(0.3, 0.38)) * (down ? 1 : -1);
            await afterInput("touchend", () => touch([x, y, x + innerWidth * between(-0.03, 0.03), y - distance]));
            await sleep(between(250, 450));
        }
        throw new Error("Couldn't scroll to the chapter list");
    };

    const click = async (getTarget) => {
        for (let attempt = 0; attempt < MAX_TAPS; attempt++) {
            const target = getTarget();
            if (!target || target.disabled) throw new Error("The required chapter-list control is unavailable");
            await scrollTo(target);
            const rect = target.getBoundingClientRect();
            const x = rect.left + rect.width * between(0.3, 0.7);
            const y = rect.top + rect.height * between(0.3, 0.7);
            const under = document.elementFromPoint(x, y);
            if (!target.contains(under) && !isAdOverlay(under)) {
                await sleep(300);
                continue;
            }
            const event = await afterInput("click", () => touch([x, y]));
            if (target.contains(event.target)) return;
        }
        throw new Error("Couldn't activate the chapter-list control");
    };
    const waitFor = async (read, description) => {
        const deadline = Date.now() + PAGE_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const result = read();
            if (result) return result;
            await sleep(150);
        }
        throw new Error(`Timed out ${description}`);
    };
    const dateButton = () => [...section().querySelectorAll(".mchap-toolbar__sort button")]
        .find((button) => button.textContent.trim() === "Date");
    const readPage = (page) => waitFor(() => {
        const result = snapshot(chapterPath);
        if (result.status === "error") throw new Error(result.error);
        return result.status === "ready" && result.page === page ? result : null;
    }, `loading chapter-list page ${page}`);
    const walk = async () => {
        await waitFor(() => section()?.querySelector(".mchap-toolbar"), "loading the chapter toolbar");
        const groupButton = () => section().querySelector(".mpage__group > button");
        if (groupButton()?.textContent.trim() !== "All groups") {
            await click(groupButton);
            const allGroups = () => [...section().querySelectorAll('[role="menuitemradio"]')]
                .find((button) => button.textContent.trim() === "All groups");
            await waitFor(allGroups, "opening the groups menu");
            await click(allGroups);
        }
        // Clicking an inactive sort selects descending order; an active ascending sort toggles it.
        if (dateButton()?.getAttribute("title") !== "Sort by date (desc)") await click(dateButton);
        await waitFor(() => dateButton()?.getAttribute("title") === "Sort by date (desc)", "sorting newest uploads first");
        const sorted = await waitFor(() => {
            const result = snapshot(chapterPath);
            if (result.status === "error") throw new Error(result.error);
            return result.status === "ready" ? result : null;
        }, "loading the sorted chapter list");
        const firstPage = () => section().querySelector('button[aria-label="First page"]') ||
            [...section().querySelectorAll(".npager button")].find((button) => button.textContent.trim() === "1");
        if (sorted.page !== 1) await click(firstPage);
        const ids = new Set();
        let total = null;
        let end = 0;
        for (let page = 1; page <= maxPages; page++) {
            const result = await readPage(page);
            if (total !== null && result.total !== total) throw new Error("The chapter count changed during refresh; refresh again");
            total = result.total;
            if (total === 0) return finish(true);
            if (result.from !== end + 1) throw new Error("The website skipped a chapter-list page");
            for (const item of result.chapters) {
                if (ids.has(item.id)) throw new Error("Chapter pages overlapped during refresh; refresh again");
                ids.add(item.id);
                chapters.push(item);
            }
            end = result.to;
            if (result.chapters.some((item) => known.has(item.id))) return finish(true);
            if (end === total) {
                if (ids.size !== total) throw new Error("The chapter list is incomplete");
                return finish(true);
            }
            if (page < maxPages) {
                // Pace UI pagination too: some hosts do not intercept WebView fetches.
                await sleep(3000);
                await click(() => section().querySelector('button[aria-label="Next page"]'));
            }
        }
        throw new Error(`Chapter list exceeded ${maxPages} pages`);
    };
    const start = () => walk().catch((error) => finish(false, `Comix chapters: ${error.message || error}`));
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
}
