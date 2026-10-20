(chapterId) => {
    const waiting = (stage) => ({ status: "waiting", stage });
    const error = (message) => ({ status: "error", stage: "reader", error: message });
    const pathId = window.location.pathname.match(/\/(\d+)-chapter-/)?.[1];
    if (pathId && pathId !== String(chapterId)) return error("Reader navigated to a different chapter");
    const initial = document.querySelector("script#initial-data");
    if (!initial) return waiting("loading the chapter document");
    let data;
    try { data = JSON.parse(initial.textContent); }
    catch { return error("Reader initial data is invalid"); }
    if (!data.read) return waiting("opening the chapter reader");
    if (String(data.read.chapterId) !== String(chapterId)) return error("Reader opened a different chapter");
    const reader = document.querySelector(".rpage-main");
    if (!reader) return waiting("rendering the chapter");
    const progress = [...document.querySelectorAll(".rpage-progress__seg")]
        .map((element) => Number((element.getAttribute("aria-label") || "").match(/^Go to page (\d+)$/)?.[1]))
        .sort((a, b) => a - b);
    if (!progress.length) return waiting("reading the complete page count");
    if (progress.some((number, index) => number !== index + 1)) return error("Reader page count is inconsistent");
    const pages = [...reader.querySelectorAll(".rpage-page[data-page]")]
        .map((element) => ({ element, number: Number(element.getAttribute("data-page")) }))
        .sort((a, b) => a.number - b.number);
    if (pages.length !== progress.length) return waiting(`rendering pages (${pages.length}/${progress.length})`);
    if (pages.some((page, index) => page.number !== index + 1)) return error("Reader page numbering is inconsistent");
    const items = [];
    for (const page of pages) {
        const source = page.element.querySelector("img.rpage-page__img")?.getAttribute("src");
        if (!source) continue;
        let url;
        try { url = new URL(source, document.baseURI); }
        catch { return error(`Reader page ${page.number} has an invalid image URL`); }
        if (!/^https?:$/.test(url.protocol)) return error(`Reader page ${page.number} uses an unsupported image format`);
        items.push({ number: page.number, url: url.href });
    }
    if (items.length !== progress.length) return waiting(`loading image addresses (${items.length}/${progress.length})`);
    return { status: "ready", stage: "complete", count: progress.length, items };
}
