const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const asset = (name) => fs.readFileSync(path.join(__dirname, "../assets", name), "utf8");
const snapshotScript = asset("reader_snapshot.js");
const captureScript = asset("chapter_pages.js");

// Selectors match the live reader. paint() defers rendering to exercise React
// updates between native WebView polls rather than assuming synchronous clicks.
function fixture({ count = 118, preload = "some", progress = "Left" } = {}) {
    const f = {
        count, preload, progress, settings: false, reader: true,
        pathname: "/title/example/12345-chapter-1",
        initial: JSON.stringify({ read: { chapterId: 12345 } }),
        calls: [], pending: [],
        progressNumbers: Array.from({ length: count }, (_, i) => i + 1),
        pages: Array.from({ length: count }, (_, i) => ({
            number: i + 1,
            url: `https://images.example/hi/page-${i + 1}?v3&r=2`,
        })),
    };
    let renderedPreload = preload;
    const radio = (value) => ({
        value,
        get checked() { return f.preload === value; },
        click() {
            f.calls.push(`preload:${value}`);
            f.pending.push(() => { f.preload = value; renderedPreload = value; });
        },
    });
    const progressButton = (value) => ({
        getAttribute(name) {
            return name === "aria-label" ? `Progress bar ${value}`
                : name === "aria-checked" ? String(f.progress === value) : null;
        },
        click() {
            f.calls.push(`progress:${value}`);
            f.pending.push(() => { f.progress = value; });
        },
    });
    const progressButtons = ["Left", "Top", "Bottom", "Right", "Off"].map(progressButton);
    const reader = {
        querySelectorAll(selector) {
            assert.equal(selector, ".rpage-page[data-page]");
            return f.pages.map((page) => ({
                getAttribute: () => String(page.number),
                querySelector(selector) {
                    assert.equal(selector, "img.rpage-page__img");
                    if (renderedPreload !== "all" && page.number > 3) return null;
                    return { getAttribute: () => page.url };
                },
            }));
        },
    };
    const document = {
        baseURI: "https://comix.to/title/example/12345-chapter-1",
        querySelector(selector) {
            if (selector === "script#initial-data") return f.initial === null ? null : { textContent: f.initial };
            if (selector === ".rpage-main") return f.reader ? reader : null;
            if (selector === ".rpage-progress__seg") return f.progress !== "Off" && f.count ? {} : null;
            if (selector === 'button[aria-label="Settings"]') return {
                click() { f.calls.push("open"); f.pending.push(() => { f.settings = true; }); },
            };
            if (!f.settings) return null;
            if (selector === 'button[aria-label="Close settings"]') return {
                click() { f.calls.push("close"); f.pending.push(() => { f.settings = false; }); },
            };
            if (selector === 'input[name="preload"]:checked') return f.preload ? radio(f.preload) : null;
            const value = selector.match(/^input\[name="preload"\]\[value="(.*)"\]$/)?.[1];
            if (value) return radio(value);
            if (selector === '[aria-label="Progress bar position"] [aria-checked="true"]') return progressButton(f.progress);
            if (selector === 'button[aria-label="Progress bar Left"]') return progressButtons[0];
            throw new Error(`Unexpected selector: ${selector}`);
        },
        querySelectorAll(selector) {
            if (selector === ".rpage-progress__seg") return f.progress === "Off" ? [] : f.progressNumbers.map((n) => ({
                getAttribute: () => `Go to page ${n}`,
            }));
            if (selector === '[aria-label="Progress bar position"] [role="radio"]') return f.settings ? progressButtons : [];
            throw new Error(`Unexpected selector: ${selector}`);
        },
    };
    const context = vm.createContext({
        URL, document,
        window: { location: { get pathname() { return f.pathname; } } },
    });
    const snapshot = vm.runInContext(`(${snapshotScript})`, context);
    const capture = vm.runInContext(`(${captureScript})`, context);
    f.state = {};
    const plain = (value) => JSON.parse(JSON.stringify(value));
    f.read = () => plain(snapshot(12345));
    f.tick = () => plain(capture(snapshot, 12345, f.state));
    f.paint = () => { f.pending.splice(0).forEach((apply) => apply()); };
    f.finish = () => {
        for (let i = 0; i < 15; i++) {
            const result = f.tick();
            f.paint();
            if (result.status !== "waiting") return result;
        }
        assert.fail("Reader never finished");
    };
    return f;
}

test("captures all 118 pages in order, preserving final hosts, paths and queries", () => {
    const f = fixture({ preload: "all" });
    f.pages.reverse();
    const result = f.read();
    assert.equal(result.status, "ready");
    assert.equal(result.count, 118);
    assert.deepEqual(result.items.map((x) => x.number), Array.from({ length: 118 }, (_, i) => i + 1));
    assert.equal(result.items[117].url, "https://images.example/hi/page-118?v3&r=2");
});

test("does not return a partial chapter when lazy images are missing", () => {
    assert.deepEqual(fixture().read(), { status: "waiting", stage: "loading image addresses (3/118)" });
});

test("waits for a missing final page wrapper", () => {
    const f = fixture({ preload: "all" });
    f.pages.pop();
    assert.deepEqual(f.read(), { status: "waiting", stage: "rendering pages (117/118)" });
});

test("requires the reader's total count even when images are present", () => {
    assert.equal(fixture({ preload: "all", progress: "Off" }).read().status, "waiting");
    assert.equal(fixture({ count: 0, preload: "all" }).read().status, "waiting");
});

test("rejects duplicate or skipped page numbers", () => {
    const f = fixture({ preload: "all" });
    f.pages[117].number = 117;
    assert.match(f.read().error, /numbering/);
});

test("rejects inconsistent progress numbering", () => {
    const f = fixture({ preload: "all" });
    f.progressNumbers[117] = 119;
    assert.match(f.read().error, /page count/);
});

test("does not return another chapter after navigation", () => {
    const f = fixture({ preload: "all" });
    f.pathname = "/title/example/99999-chapter-2";
    assert.match(f.read().error, /different chapter/);
    f.pathname = "/title/example/12345-chapter-1";
    f.initial = JSON.stringify({ read: { chapterId: 99999 } });
    assert.match(f.read().error, /different chapter/);
});

test("distinguishes loading, non-reader and malformed initial documents", () => {
    const f = fixture();
    f.initial = null;
    assert.equal(f.read().stage, "loading the chapter document");
    f.initial = "{}";
    assert.equal(f.read().stage, "opening the chapter reader");
    f.initial = "invalid";
    assert.match(f.read().error, /initial data is invalid/);
    f.initial = JSON.stringify({ read: { chapterId: 12345 } });
    f.reader = false;
    assert.equal(f.read().stage, "rendering the chapter");
});

test("rejects blob/canvas placeholders instead of inventing an image URL", () => {
    const f = fixture({ preload: "all" });
    for (const url of ["blob:https://comix.to/id", "data:image/png;base64,AAAA", "javascript:void(0)"]) {
        f.pages[0].url = url;
        assert.match(f.read().error, /unsupported image format/);
    }
    f.pages[0].url = "https://[invalid";
    assert.match(f.read().error, /invalid image URL/);
});

test("resolves relative image addresses against the reader document", () => {
    const f = fixture({ preload: "all" });
    f.pages[0].url = "/image.webp?version=3";
    assert.equal(f.read().items[0].url, "https://comix.to/image.webp?version=3");
});

test("uses Preload all, captures 118 pages and restores the previous preference", () => {
    const f = fixture();
    const result = f.finish();
    assert.equal(result.status, "ready");
    assert.equal(result.items.length, 118);
    assert.equal(result.items[117].number, 118);
    assert.deepEqual(f.calls, ["open", "preload:all", "preload:some", "close"]);
    assert.equal(f.preload, "some");
    assert.equal(f.settings, false);
    assert.equal(f.read().status, "waiting"); // Copy survives restoring lazy loading.
});

test("temporarily enables the page count and restores progress Off", () => {
    const f = fixture({ progress: "Off" });
    assert.equal(f.finish().items.length, 118);
    assert.deepEqual(f.calls, ["open", "preload:all", "progress:Left", "preload:some", "progress:Off", "close"]);
    assert.equal(f.progress, "Off");
});

test("leaves complete short chapters and existing Preload all preferences untouched", () => {
    for (const options of [{ count: 2 }, { preload: "all" }]) {
        const f = fixture(options);
        assert.equal(f.finish().status, "ready");
        assert.deepEqual(f.calls, []);
    }
});

test("does not close a settings panel that was already open", () => {
    const f = fixture();
    f.settings = true;
    assert.equal(f.finish().status, "ready");
    assert.equal(f.settings, true);
    assert.deepEqual(f.calls, ["preload:all", "preload:some"]);
});

test("waits for delayed settings rendering without toggling it closed", () => {
    const f = fixture();
    assert.equal(f.tick().status, "waiting");
    assert.equal(f.tick().status, "waiting");
    assert.deepEqual(f.calls, ["open"]);
    f.paint();
    assert.equal(f.finish().status, "ready");
});

test("reports a missing preload setting rather than returning partial pages", () => {
    const f = fixture({ preload: null });
    f.settings = true;
    assert.match(f.tick().error, /preload setting is missing/);
});

test("rejects chapter changes while finishing capture", () => {
    const f = fixture();
    for (let i = 0; i < 3; i++) { f.tick(); f.paint(); }
    assert.ok(f.state.result);
    f.pathname = "/title/example/99999-chapter-2";
    assert.match(f.tick().error, /different chapter/);
});
