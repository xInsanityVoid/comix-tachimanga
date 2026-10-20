const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../assets/chapter_pages.js"), "utf8");

function runChapter(result, {
    error,
    readyState = "complete",
    available = true,
    extras = [],
    discoveryError,
    document = {},
    location = { pathname: "/title/example/12345-chapter-1" },
    onTick = () => {},
} = {}) {
    const calls = [];
    const events = new Map();
    const replies = [];
    let elapsed = 0;
    const client = {
        async request(url, config) {
            assert.equal(this, client);
            calls.push({ url, config });
            if (error) throw error;
            return result;
        },
    };
    const siteApi = (select) => async () => {
        if (discoveryError) throw discoveryError;
        return select(
            available ? [{ owner: client, key: "request", value: client.request }, ...extras] : [],
            (value) => value === client.request,
        );
    };
    const chapterPages = vm.runInNewContext(`(${script})`, {
        URL,
        Date: { now: () => elapsed },
        setTimeout(callback, milliseconds) {
            elapsed += milliseconds;
            onTick(elapsed);
            queueMicrotask(callback);
        },
        document: {
            readyState,
            baseURI: "https://comix.to/title/example/12345-chapter-1",
            querySelector: () => null,
            querySelectorAll: () => [],
            ...document,
        },
        window: {
            location,
            addEventListener(name, listener, options) {
                assert.equal(options.once, true);
                events.set(name, listener);
            },
        },
    });
    const completed = new Promise((resolve) => {
        chapterPages(
            siteApi,
            12345,
            (payload) => {
                replies.push({ pages: JSON.parse(payload) });
                resolve(replies.at(-1));
            },
            (message) => {
                replies.push({ error: message });
                resolve(replies.at(-1));
            },
        );
    });
    return { completed, calls, events, replies, elapsed: () => elapsed };
}

function readerFixture({
    count = 118,
    numbers = Array.from({ length: count }, (_, index) => index + 1),
    lazy = true,
    sourceFor = (number) => `https://images.example/hi/page-${number}?v3&token=opaque%2Bvalue`,
} = {}) {
    const state = {
        now: 0,
        scrolls: [],
        initialData: { read: { chapterId: 12345 } },
        location: { pathname: "/title/example/12345-chapter-1" },
    };
    const elements = numbers.map((number) => ({
        source: !lazy || number <= 3 ? sourceFor(number) : null,
        revealAt: null,
        getAttribute(name) {
            assert.equal(name, "data-page");
            return String(number);
        },
        querySelector(selector) {
            assert.equal(selector, "img.rpage-page__img");
            return this.source ? {
                getAttribute: () => this.source,
                complete: false,
                naturalWidth: 0,
            } : null;
        },
        scrollIntoView(options) {
            assert.equal(options.block, "center");
            assert.equal(options.behavior, "instant");
            state.scrolls.push(number);
            if (this.revealAt === null) this.revealAt = state.now + 200;
        },
    }));
    state.elements = elements;
    state.progress = Array.from({ length: count }, (_, index) => ({
        getAttribute: () => `Go to page ${index + 1}`,
    }));
    state.reader = { querySelectorAll: () => state.elements };
    return {
        state,
        document: {
            querySelectorAll(selector) {
                assert.equal(selector, ".rpage-progress__seg");
                return state.progress;
            },
            querySelector(selector) {
                if (selector === "script#initial-data") {
                    return state.initialData ? { textContent: JSON.stringify(state.initialData) } : null;
                }
                assert.equal(selector, ".rpage-main--long-strip");
                return state.reader;
            },
        },
        location: state.location,
        onTick(elapsed) {
            state.now = elapsed;
            elements.forEach((element, index) => {
                if (element.revealAt !== null && elapsed >= element.revealAt) {
                    element.source = sourceFor(numbers[index]);
                }
            });
        },
    };
}

test("reads pages when the GET helper is exported without a route function", async () => {
    const pages = {
        baseUrl: "https://images.example",
        items: [{ url: "one.webp", s: 1 }],
        alt: ["backup.example"],
        node: "n1",
    };
    const run = runChapter(pages);
    assert.deepEqual(await run.completed, { pages });
    assert.equal(run.calls.length, 1);
    assert.equal(run.calls[0].url, "/chapters/12345");
    assert.equal(run.calls[0].config.params, undefined);
});

test("does not depend on the route function's source representation", async () => {
    const route = function renamedRoute(id) { return "/chapters/" + id; };
    const pages = { items: [{ url: "https://images.example/one.webp" }] };
    const run = runChapter(pages, {
        extras: [{ owner: { route }, key: "route", value: route }],
    });
    assert.deepEqual(await run.completed, { pages });
});

test("retains page metadata from a wrapped response", async () => {
    const pages = {
        items: [{ url: "one.webp" }, { url: "two.webp" }],
        baseUrl: "https://images.example",
        alt: ["backup.example"],
    };
    const run = runChapter({ renamedPages: pages, metadata: { id: 12345 } });
    assert.deepEqual(await run.completed, { pages });
});

test("accepts bare page arrays and wrapped page arrays", async () => {
    const items = [{ url: "https://images.example/one.webp" }];
    for (const result of [items, { renamedPages: items }]) {
        assert.deepEqual(await runChapter(result).completed, { pages: { items } });
    }
});

test("rejects a missing helper and missing reader without issuing a request", async () => {
    const run = runChapter(null, { available: false });
    assert.deepEqual(await run.completed, {
        error: "Could not find the site's chapter API; Reader did not expose a complete long-strip page list",
    });
    assert.equal(run.calls.length, 0);
    assert.equal(run.elapsed(), 90000);
});

test("rejects malformed and empty page responses", async () => {
    for (const result of [null, {}, { items: [] }, { items: [{ url: 42 }] }]) {
        assert.deepEqual(await runChapter(result).completed, {
            error: "Chapter pages came back in a shape the extension doesn't recognise",
        });
    }
});

test("reports HTTP and transport errors from the site's helper", async () => {
    assert.deepEqual(await runChapter(null, {
        error: { response: { status: 502 }, message: "Bad gateway" },
    }).completed, { error: "Chapter pages failed: HTTP 502" });
    assert.deepEqual(await runChapter(null, {
        error: new Error("Connection interrupted"),
    }).completed, { error: "Chapter pages failed: Connection interrupted" });
});

test("waits for the page to load before discovering its API", async () => {
    const pages = { items: [{ url: "https://images.example/one.webp" }] };
    const run = runChapter(pages, { readyState: "loading" });
    assert.equal(run.calls.length, 0);
    assert.equal(run.events.has("load"), true);
    run.events.get("load")();
    assert.deepEqual(await run.completed, { pages });
});

test("collects all 118 lazy pages in numeric order without waiting for image loads", async () => {
    const fixture = readerFixture({ numbers: Array.from({ length: 118 }, (_, index) => 118 - index) });
    const run = runChapter(null, { available: false, ...fixture });
    const result = await run.completed;
    assert.equal(result.pages.items.length, 118);
    assert.equal(result.pages.items[0].url, "https://images.example/hi/page-1?v3&token=opaque%2Bvalue");
    assert.equal(result.pages.items[117].url, "https://images.example/hi/page-118?v3&token=opaque%2Bvalue");
    assert.equal(run.replies.length, 1);
    assert.equal(run.calls.length, 0);
    assert.ok(fixture.state.scrolls.includes(118));
    assert.ok(run.elapsed() < 90000);
});

test("uses the reader after a discovery error and accepts repeated image URLs", async () => {
    const fixture = readerFixture({ count: 2, sourceFor: () => "https://images.example/repeated.jpg" });
    const run = runChapter(null, { discoveryError: new Error("Comix API v56: GET helper missing"), ...fixture });
    assert.deepEqual(await run.completed, {
        pages: { items: [
            { url: "https://images.example/repeated.jpg" },
            { url: "https://images.example/repeated.jpg" },
        ] },
    });
});

test("does not fall back when a discovered API request fails or returns malformed data", async () => {
    const fixture = readerFixture({ count: 1 });
    const requestFailure = await runChapter(null, {
        error: { response: { status: 502 } },
        ...fixture,
    }).completed;
    assert.equal(requestFailure.error, "Chapter pages failed: HTTP 502");
    const malformed = await runChapter({ items: [] }, fixture).completed;
    assert.equal(malformed.error, "Chapter pages came back in a shape the extension doesn't recognise");
    assert.equal(fixture.state.scrolls.length, 0);
});

test("rejects missing, duplicate and noninteger reader page labels", async () => {
    for (const numbers of [[1, 3], [1, 1], [1, 2.5], [0, 1]]) {
        const fixture = readerFixture({ numbers, lazy: false });
        const result = await runChapter(null, { available: false, ...fixture }).completed;
        assert.match(result.error, /Reader page numbering is incomplete$/);
    }
});

test("never returns partial pages when a URL stays missing, blob or data", async () => {
    for (const missing of [null, "blob:https://comix.to/local", "data:image/png;base64,AAAA"]) {
        const fixture = readerFixture({ count: 4, sourceFor: (number) => (
            number === 4 ? missing : `https://images.example/${number}.webp`
        ) });
        const run = runChapter(null, {
            discoveryError: new Error("Comix API v56: no main script"),
            ...fixture,
        });
        assert.deepEqual(await run.completed, {
            error: "Comix API v56: no main script; Reader exposed 3 of 4 HTTP page URLs",
        });
        assert.equal(run.replies.length, 1);
        assert.equal(run.elapsed(), 90000);
    }
});

test("rejects initial reader data for a different chapter", async () => {
    const fixture = readerFixture({ count: 1 });
    fixture.state.initialData.read.chapterId = 54321;
    const result = await runChapter(null, { available: false, ...fixture }).completed;
    assert.match(result.error, /Reader opened a different chapter$/);
    assert.equal(fixture.state.scrolls.length, 0);
});

test("can read when initial reader data is absent", async () => {
    const fixture = readerFixture({ count: 1 });
    fixture.state.initialData = null;
    const result = await runChapter(null, { available: false, ...fixture }).completed;
    assert.equal(result.pages.items.length, 1);
});

test("rejects navigation, reader replacement or page count changes during collection", async () => {
    for (const change of [
        (state) => { state.location.pathname = "/title/example/54321-chapter-2"; },
        (state) => { state.reader = { querySelectorAll: () => state.elements }; },
        (state) => { state.elements = state.elements.slice(0, 3); },
        (state) => { state.initialData.read.chapterId = 54321; },
    ]) {
        const fixture = readerFixture({ count: 4 });
        const result = await runChapter(null, {
            available: false,
            ...fixture,
            onTick(elapsed) {
                fixture.onTick(elapsed);
                if (elapsed === 600) change(fixture.state);
            },
        }).completed;
        assert.match(result.error, /Reader (?:changed|page count changed|opened a different)/);
    }
});

test("waits for the placeholder count to settle before collecting", async () => {
    const fixture = readerFixture({ count: 5, lazy: false });
    const allPages = fixture.state.elements;
    fixture.state.elements = allPages.slice(0, 3);
    const run = runChapter(null, {
        available: false,
        ...fixture,
        onTick(elapsed) {
            fixture.onTick(elapsed);
            if (elapsed === 300) fixture.state.elements = allPages;
        },
    });
    assert.equal((await run.completed).pages.items.length, 5);
    assert.equal(run.elapsed(), 800);
});

test("does not return a stable partial wrapper list that is smaller than reader progress", async () => {
    const fixture = readerFixture({ count: 118, lazy: false });
    fixture.state.elements = fixture.state.elements.slice(0, 3);
    const run = runChapter(null, { available: false, ...fixture });
    assert.match((await run.completed).error, /Reader did not expose a complete long-strip page list$/);
    assert.equal(run.elapsed(), 90000);
    assert.equal(run.replies.length, 1);
});

test("requires complete, unique progress labels and a long-strip reader", async () => {
    for (const change of [
        (state) => { state.progress = []; },
        (state) => { state.progress = [state.progress[0], state.progress[0]]; },
        (state) => { state.reader = null; },
    ]) {
        const fixture = readerFixture({ count: 2, lazy: false });
        change(fixture.state);
        const result = await runChapter(null, { available: false, ...fixture }).completed;
        assert.match(result.error, /Reader (?:did not expose a complete long-strip page list|progress numbering is incomplete)$/);
    }
});
