(chapterPath) => {
    const waiting = (stage) => ({ status: "waiting", stage });
    const error = (message) => ({ status: "error", error: message });
    if (!window.location.pathname.startsWith(chapterPath)) return error("Opened a different series");
    const section = document.querySelector(".mpage__chapters");
    if (!section) return waiting("loading the chapter section");
    const list = section.querySelector(".mchap-list");
    if (list?.getAttribute("aria-busy") === "true") return waiting("loading chapter rows");
    const group = section.querySelector(".mpage__group > button");
    if (group?.textContent.trim() !== "All groups") return waiting("selecting all groups");
    if (section.querySelector(".mchap-search input")?.value) return error("The chapter search is not empty");
    const sort = section.querySelector('.mchap-toolbar__sort button[aria-pressed="true"]');
    if (sort?.getAttribute("title") !== "Sort by date (desc)") return waiting("sorting newest uploads first");
    const hint = section.querySelector(".mchap-foot__hint")?.textContent || "";
    const range = hint.match(/Showing\s+([\d,]+)\s+to\s+([\d,]+)\s+of\s+([\d,]+)\s+items?/i);
    if (!range) return waiting("reading the chapter count");
    const [from, to, total] = range.slice(1).map((s) => Number(s.replaceAll(",", "")));
    const current = section.querySelector('.npager [aria-current="page"]');
    const page = current ? Number(current.textContent.trim()) : 1;
    const rows = [...section.querySelectorAll(".mchap-item")];
    if (total === 0 && from === 0 && to === 0 && !rows.length) {
        return { status: "ready", page, from, to, total, chapters: [] };
    }
    if (from < 1 || to < from || total < to || !Number.isInteger(page) || page < 1) {
        return error("Chapter pagination is inconsistent");
    }
    if (rows.length !== to - from + 1) return waiting("rendering all chapter rows");
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
            group: groupName ? { name: groupName, ...(Number.isSafeInteger(groupId) ? { id: groupId } : {}) } : null,
            isOfficial: groupId === 10702 || groupName === "Official" });
    }
    if (new Set(chapters.map((item) => item.id)).size !== chapters.length) return error("Duplicate chapter rows on one page");
    return { status: "ready", page, from, to, total, chapters };
}
