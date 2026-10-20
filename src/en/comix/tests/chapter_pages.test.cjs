const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../assets/chapter_pages.js"), "utf8");

function runChapter(result, { error, readyState = "complete", available = true, extras = [] } = {}) {
    const calls = [];
    const events = new Map();
    const client = {
        async request(url, config) {
            assert.equal(this, client);
            calls.push({ url, config });
            if (error) throw error;
            return result;
        },
    };
    const siteApi = (select) => async () => select(
        available ? [{ owner: client, key: "request", value: client.request }, ...extras] : [],
        (value) => value === client.request,
    );
    const chapterPages = vm.runInNewContext(`(${script})`, {
        document: { readyState },
        window: {
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
            (payload) => resolve({ pages: JSON.parse(payload) }),
            (message) => resolve({ error: message }),
        );
    });
    return { completed, calls, events };
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

test("rejects a missing helper without issuing a request", async () => {
    const run = runChapter(null, { available: false });
    assert.deepEqual(await run.completed, { error: "Could not find the site's chapter API" });
    assert.equal(run.calls.length, 0);
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
