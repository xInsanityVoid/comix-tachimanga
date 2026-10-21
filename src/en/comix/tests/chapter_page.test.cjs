const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Execute the shipped parser against hand-authored rendered-DOM fixtures.
// This tests extraction, not browser navigation or Tachimanga compatibility.
const source = fs.readFileSync(path.join(__dirname, "../assets/chapter_page.js"), "utf8");
const element = (textContent = "", attrs = {}) => ({ textContent, getAttribute: key => attrs[key] ?? null });

function row(id, label = "Ch.12.5", name = "Bonus", group = 4725) {
    const parts = {
        "a.mchap-row__primary": element(label + (name ? ` — ${name}` : ""), {href: `/title/abc-example/${id}-chapter-12`} ),
        ".mchap-row__ch": element(label),
        ".mchap-row__group": group === null ? null : element(group === 10702 ? "Official" : "Asura Scans", {href: `/groups/${group}`}),
        ".mchap-row__likes": element("1.2k"),
        ".mchap-row__time": element("1d ago"),
    };
    return {parts, querySelector: selector => parts[selector] ?? null};
}

function fixture() {
    const f = {
        title: "Example - Comix", sectionPresent: true, listPresent: true, busy: false,
        group: "All groups", search: "", hint: "Showing 1 to 2 of 2 items", page: "1",
        location: "https://comix.to/title/abc-example", initialData: null, empty: false,
        rows: [row(101), row(102, "Ch.12", "", 10702)],
    };
    const section = {
        querySelector(selector) {
            const values = {
                ".mchap-list": f.listPresent ? element("", {"aria-busy": f.busy ? "true" : null}) : null,
                ".mpage__group > button": f.group === null ? null : element(f.group),
                ".mchap-search input": {value: f.search},
                ".mchap-foot__hint": f.hint === null ? null : element(f.hint),
                '.npager [aria-current="page"]': f.page === null ? null : element(f.page),
                ".uempty": f.empty ? element("No chapters") : null,
            };
            assert.ok(Object.hasOwn(values, selector), `Unexpected section selector: ${selector}`);
            return values[selector];
        },
        querySelectorAll(selector) { assert.equal(selector, ".mchap-item"); return f.rows; },
    };
    const document = {
        get title() { return f.title; },
        querySelector(selector) {
            if (selector === ".mpage__chapters") return f.sectionPresent ? section : null;
            assert.equal(selector, "script#initial-data");
            return f.initialData === null ? null : element(f.initialData);
        },
    };
    const context = vm.createContext({URL, document, window: {get location() { return new URL(f.location); }}});
    const parse = vm.runInContext(`(${source})`, context);
    f.read = (expectedPage = 1, expectedFrom = 1) => JSON.parse(JSON.stringify(parse("/title/abc-", expectedPage, expectedFrom)));
    return f;
}

test("extracts decimal chapters, title, groups, votes and official status", () => {
    const result = fixture().read();
    assert.equal(result.status, "ready");
    assert.deepEqual([result.page, result.from, result.to, result.total], [1, 1, 2, 2]);
    assert.deepEqual(result.chapters[0], {
        id: 101, url: "/title/abc-example/101-chapter-12", number: 12.5, name: "Bonus", votes: 1200,
        createdAtFormatted: "1d ago", group: {name: "Asura Scans", id: 4725}, isOfficial: false,
    });
    assert.equal(result.chapters[1].isOfficial, true);
    assert.equal(result.chapters[1].name, "");
});

test("waits through missing section, list and delayed rows before accepting a complete page", () => {
    const f = fixture();
    f.sectionPresent = false;
    assert.equal(f.read().status, "waiting");
    f.sectionPresent = true; f.listPresent = false;
    assert.equal(f.read().status, "waiting");
    f.listPresent = true; f.busy = true;
    assert.equal(f.read().status, "waiting");
    f.busy = false; const last = f.rows.pop();
    assert.equal(f.read().status, "waiting");
    f.rows.push(last);
    assert.equal(f.read().status, "ready");
});

test("page-two URL cannot return the first page while the rendered pager is stale", () => {
    const f = fixture(); f.location += "?page=2";
    assert.equal(f.read(2, 3).status, "waiting");
    f.page = "2"; f.hint = "Showing 3 to 4 of 4 items";
    f.rows = [row(99), row(98)];
    const result = f.read(2, 3);
    assert.equal(result.status, "ready");
    assert.deepEqual(result.chapters.map(chapter => chapter.id), [99, 98]);
    assert.equal(result.from, 3);
});

test("updated pager with previous-page rows waits for the expected footer range", () => {
    const f = fixture(); f.location += "?page=2"; f.page = "2";
    assert.equal(f.read(2, 21).status, "waiting");
    f.hint = "Showing 21 to 22 of 22 items";
    f.rows = [row(99), row(98)];
    assert.equal(f.read(2, 21).status, "ready");
});

test("rejects navigation to a different series or requested page", () => {
    const f = fixture(); f.location = "https://comix.to/title/other-series";
    assert.match(f.read().error, /different series/);
    f.location = "https://comix.to/title/abc-example?page=3";
    assert.match(f.read(2).error, /different chapter-list page/);
});

test("single-page titles need no pager, but a missing pager cannot satisfy page two", () => {
    const f = fixture(); f.page = null;
    assert.equal(f.read().status, "ready");
    f.location += "?page=2";
    assert.equal(f.read(2).status, "waiting");
});

test("missing footer and empty or partially rendered rows never become a complete list", () => {
    const f = fixture(); f.rows = [];
    assert.equal(f.read().status, "waiting");
    f.hint = null;
    assert.equal(f.read().status, "waiting");
    f.hint = "Showing 0 to 0 of 0 items";
    assert.notEqual(f.read().status, "ready");
});

test("comma-separated pagination totals and a short final page preserve the full count", () => {
    const f = fixture(); f.location += "?page=51"; f.page = "51";
    f.hint = "Showing 1,001 to 1,002 of 1,002 items";
    const result = f.read(51, 1001);
    assert.equal(result.status, "ready");
    assert.deepEqual([result.from, result.to, result.total], [1001, 1002, 1002]);
});

test("invalid pagination ranges are errors rather than successful empty results", () => {
    for (const hint of ["Showing 3 to 2 of 5 items", "Showing 1 to 3 of 2 items", "Showing 0 to 2 of 2 items"]) {
        const f = fixture(); f.hint = hint;
        assert.match(f.read().error, /inconsistent chapter pagination/, hint);
    }
});

test("active group and search filters cannot silently truncate the chapter list", () => {
    const f = fixture(); f.group = "Asura Scans";
    assert.match(f.read().error, /filtered the chapter groups/);
    f.group = "All groups"; f.search = "123";
    assert.match(f.read().error, /filtered the chapter list/);
});

test("foreign hosts and other-series chapter links are rejected", () => {
    for (const href of ["https://other.example/title/abc-example/101-chapter-12", "/title/other-series/101-chapter-12"]) {
        const f = fixture(); f.rows[0].parts["a.mchap-row__primary"] = element("Ch.12", {href});
        assert.match(f.read().error, /different series/);
    }
});

test("missing links, invalid chapter IDs and unparseable chapter labels are errors", () => {
    const f = fixture(); f.rows[0].parts["a.mchap-row__primary"] = null;
    assert.match(f.read().error, /link is missing/);
    f.rows[0] = row(0);
    assert.match(f.read().error, /number or ID/);
    f.rows[0] = row(101, "Unknown");
    assert.match(f.read().error, /number or ID/);
});

test("repeated chapter IDs cannot make duplicate rows look complete", () => {
    const f = fixture(); f.rows[1] = row(101);
    assert.match(f.read().error, /Duplicate chapter rows/);
});

test("vote counts accept comma, thousand and million display formats", () => {
    for (const [text, expected] of [["1,234", 1234], ["2.5k", 2500], ["1.2M", 1200000], ["0", 0]]) {
        const f = fixture(); f.rows[0].parts[".mchap-row__likes"] = element(text);
        assert.equal(f.read().chapters[0].votes, expected, text);
    }
});

test("optional missing group and time do not discard valid chapter rows", () => {
    const f = fixture(); f.rows[0] = row(101, "Chapter 12", "", null);
    f.rows[0].parts[".mchap-row__likes"] = null; f.rows[0].parts[".mchap-row__time"] = null;
    const result = f.read().chapters[0];
    assert.equal(result.group, null); assert.equal(result.createdAtFormatted, "");
    assert.equal(result.votes, 0); assert.equal(result.number, 12);
});

test("initial manga metadata survives extraction and malformed optional metadata does not lose chapters", () => {
    const f = fixture(); const queries = {'["manga","detail","abc"]': {hid: "abc", title: "Example", authors: [{title: "Author"}]}};
    f.initialData = JSON.stringify({queries});
    assert.deepEqual(f.read().queries, queries);
    f.initialData = "not JSON";
    assert.equal(f.read().status, "ready"); assert.equal(f.read().queries, null);
});

test("the explicit site block is surfaced even if a chapter section is absent", () => {
    const f = fixture(); f.title = "Third-party apps are not supported"; f.sectionPresent = false;
    assert.match(f.read().error, /blocked this browser session/);
});

test("the site's empty-state message cannot erase the library with a successful empty result", () => {
    const f = fixture(); f.empty = true; f.rows = []; f.busy = true;
    assert.equal(f.read().status, "waiting");
    f.busy = false;
    assert.equal(f.read().status, "error");
    assert.match(f.read().error, /no chapter rows/);
});
