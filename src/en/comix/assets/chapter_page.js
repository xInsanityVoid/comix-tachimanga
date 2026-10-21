(chapterPath, expectedPage, expectedFrom) => {
    const waiting = () => ({ status: "waiting" });
    const error = (message) => ({ status: "error", error: message });
    if (document.title === "Third-party apps are not supported") {
        return error("Comix blocked this browser session. Open the series in WebView to check the site.");
    }
    if (!window.location.pathname.startsWith(chapterPath)) return error("Opened a different series");
    const requestedPage = Number(new URL(window.location.href).searchParams.get("page") || 1);
    if (requestedPage !== expectedPage) return error("Comix opened a different chapter-list page");
    const section = document.querySelector(".mpage__chapters");
    if (!section) return waiting();
    const list = section.querySelector(".mchap-list");
    if (list?.getAttribute("aria-busy") === "true") return waiting();
    if (section.querySelector(".uempty")) {
        return error("Comix returned no chapter rows. Open the series in WebView to check the site.");
    }
    if (!list) return waiting();
    const group = section.querySelector(".mpage__group > button");
    if (group && group.textContent.trim() !== "All groups") return error("The website filtered the chapter groups");
    if (section.querySelector(".mchap-search input")?.value) return error("The website filtered the chapter list");

    const hint = section.querySelector(".mchap-foot__hint")?.textContent || "";
    const range = hint.match(/Showing\s+([\d,]+)\s+to\s+([\d,]+)\s+of\s+([\d,]+)\s+items?/i);
    if (!range) return waiting();
    const [from, to, total] = range.slice(1).map((value) => Number(value.replaceAll(",", "")));
    const current = section.querySelector('.npager [aria-current="page"]');
    const page = current ? Number(current.textContent.trim()) : 1;
    if (page !== expectedPage) return waiting();
    if (![from, to, total, page].every(Number.isSafeInteger) || page < 1 || from < 1 || to < from || total < to) {
        return error("The website returned inconsistent chapter pagination");
    }
    if (from !== expectedFrom) return waiting();
    const rows = [...section.querySelectorAll(".mchap-item")];
    if (rows.length !== to - from + 1) return waiting();

    const chapters = [];
    for (const row of rows) {
        const link = row.querySelector("a.mchap-row__primary");
        const href = link?.getAttribute("href");
        if (!href) return error("A chapter link is missing");
        let url;
        try { url = new URL(href, window.location.href); }
        catch { return error("A chapter link is invalid"); }
        if (url.origin !== new URL(window.location.href).origin || !url.pathname.startsWith(chapterPath)) {
            return error("A chapter link belongs to a different series");
        }
        const id = Number(url.pathname.match(/\/(\d+)-chapter-/)?.[1]);
        const label = row.querySelector(".mchap-row__ch")?.textContent.trim() || "";
        const number = Number(label.match(/(?:Ch\.?|Chapter)\s*([\d]+(?:\.\d+)?)/i)?.[1]);
        if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(number)) return error("A chapter number or ID is invalid");
        const groupElement = row.querySelector(".mchap-row__group");
        const groupName = groupElement?.textContent.trim();
        const groupId = Number(groupElement?.getAttribute("href")?.match(/\/groups\/(\d+)/)?.[1]);
        const likes = (row.querySelector(".mchap-row__likes")?.textContent || "0").trim().replaceAll(",", "");
        const votes = Math.round((Number.parseFloat(likes) || 0) * (/k$/i.test(likes) ? 1000 : /m$/i.test(likes) ? 1000000 : 1));
        const name = link.textContent.trim().slice(label.length).replace(/^\s*[-:\u2013\u2014]\s*/, "").trim();
        chapters.push({ id, url: url.pathname, number, name, votes,
            createdAtFormatted: row.querySelector(".mchap-row__time")?.textContent.trim() || "",
            group: groupName ? { name: groupName, ...(Number.isSafeInteger(groupId) && groupId > 0 ? { id: groupId } : {}) } : null,
            isOfficial: groupId === 10702 || groupName === "Official" });
    }
    if (new Set(chapters.map((item) => item.id)).size !== chapters.length) return error("Duplicate chapter rows on one page");
    let queries = null;
    try { queries = JSON.parse(document.querySelector("script#initial-data")?.textContent || "null")?.queries || null; }
    catch { /* Manga details can be requested separately if initial data is unavailable. */ }
    return { status: "ready", page, from, to, total, chapters, queries };
}
