(siteApi, chapterId, pass, reject) => {
    const findChapter = siteApi((members, isGet) => {
        const get = members.find((member) => isGet(member.value));
        // The endpoint is stable even when the site's build changes or inlines its route function.
        return get ? (id, params) => get.value.call(get.owner, `/chapters/${id}`, { params }) : null;
    });
    const isPages = (value) => value &&
        Array.isArray(value.items) &&
        value.items.length > 0 &&
        value.items.every((item) => item && typeof item.url === "string");

    const readReader = async () => {
        const deadline = Date.now() + 90000;
        const pathname = window.location.pathname;
        const urlChapter = pathname.match(/\/(\d+)-chapter-/);
        if (urlChapter && urlChapter[1] !== String(chapterId)) {
            throw new Error("Reader opened a different chapter");
        }
        const items = new Map();
        let expected = 0;
        let observed = 0;
        let observedTotal = 0;
        let stableSince = Date.now();
        let reader;
        while (Date.now() < deadline) {
            if (window.location.pathname !== pathname) throw new Error("Reader changed chapters");
            const initial = document.querySelector("script#initial-data");
            if (initial) {
                const read = JSON.parse(initial.textContent).read;
                if (read && read.chapterId != null && String(read.chapterId) !== String(chapterId)) {
                    throw new Error("Reader opened a different chapter");
                }
            }
            // Other reader modes may expose only the current page, which must not become a partial chapter.
            const currentReader = document.querySelector(".rpage-main--long-strip");
            if (expected && currentReader !== reader) throw new Error("Reader changed while collecting pages");
            reader = currentReader;
            const pages = reader ? [...reader.querySelectorAll(".rpage-page[data-page]")]
                .map((element) => ({ element, number: Number(element.getAttribute("data-page")) }))
                .sort((a, b) => a.number - b.number) : [];
            const progress = [...document.querySelectorAll(".rpage-progress__seg")]
                .map((element) => Number((element.getAttribute("aria-label") || "").match(/^Go to page (\d+)$/)?.[1]))
                .sort((a, b) => a - b);
            if (pages.some((page, index) => page.number !== index + 1)) {
                throw new Error("Reader page numbering is incomplete");
            }
            if (progress.some((number, index) => number !== index + 1)) {
                throw new Error("Reader progress numbering is incomplete");
            }
            if (pages.length !== observed || progress.length !== observedTotal) {
                if (expected) throw new Error("Reader page count changed while collecting pages");
                observed = pages.length;
                observedTotal = progress.length;
                stableSince = Date.now();
            }
            if (!expected && observed && observed === observedTotal && Date.now() - stableSince >= 500) {
                expected = observed;
            }
            if (expected) {
                for (const page of pages) {
                    const image = page.element.querySelector("img.rpage-page__img");
                    const source = image && image.getAttribute("src");
                    if (!source) continue;
                    const url = new URL(source, document.baseURI);
                    if (url.protocol === "https:" || url.protocol === "http:") {
                        items.set(page.number, { url: url.href });
                    }
                }
                if (items.size === expected) {
                    return { items: pages.map((page) => items.get(page.number)) };
                }
                // Images are blocked in this WebView; only wait for the lazy reader to assign their URLs.
                pages.find((page) => !items.has(page.number)).element.scrollIntoView({
                    block: "center",
                    behavior: "instant",
                });
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(expected
            ? `Reader exposed ${items.size} of ${expected} HTTP page URLs`
            : "Reader did not expose a complete long-strip page list");
    };

    const read = async () => {
        let chapter;
        let discoveryError = "Could not find the site's chapter API";
        try {
            chapter = await findChapter();
        } catch (error) {
            discoveryError = error && error.message || String(error);
        }
        if (!chapter) {
            try {
                return pass(JSON.stringify(await readReader()));
            } catch (error) {
                return reject(`${discoveryError}; ${error && error.message || error}`);
            }
        }
        const result = await chapter(chapterId);
        // The site's reader takes the pages either as an object or as a bare array
        const pages = [result, ...Object.values(result || {})]
            .map((value) => Array.isArray(value) ? { items: value } : value)
            .find(isPages);
        if (!pages) return reject("Chapter pages came back in a shape the extension doesn't recognise");
        pass(JSON.stringify(pages));
    };

    const start = () => read().catch((e) => {
        const status = e && e.response && e.response.status;
        reject(`Chapter pages failed: ${status ? `HTTP ${status}` : e && e.message || e}`);
    });
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
}
