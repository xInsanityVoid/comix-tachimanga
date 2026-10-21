const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const kotlin = fs.readFileSync(path.join(__dirname, "../src/eu/kanade/tachiyomi/extension/en/comix/Comix.kt"), "utf8");
const browseMethod = kotlin.slice(kotlin.indexOf("private suspend fun getMangaListFromBrowse("), kotlin.indexOf("override suspend fun getLatestUpdates("));
const template = browseMethod.match(/buildScript = \{ passPayloadName ->\s*"""([\s\S]*?)"""\.trimIndent\(\)/)?.[1];
assert.ok(template, "extract the actual shipped browse script, not a copied implementation");

const listing = {result: {items: [{hid: "fixture", title: 'Fixture "title" \\ with Unicode 漫画'}], meta: {page: 1, last_page: 1}}};

function fixture(options = {}) {
    const delivered = [];
    const script = template.replaceAll("$expectedKeyword", JSON.stringify(options.keyword || ""))
        .replaceAll("$passPayloadName", "fixturePayloadBridge");
    const document = {
        querySelector(selector) {
            assert.equal(selector, "script#initial-data");
            return options.initialData == null ? null : {textContent: options.initialData};
        },
    };
    const window = {location: {origin: "https://comix.to"}};
    function XMLHttpRequest() { this.listeners = new Map(); }
    XMLHttpRequest.prototype.open = function () {};
    XMLHttpRequest.prototype.send = function () {};
    XMLHttpRequest.prototype.addEventListener = function (name, callback) { this.listeners.set(name, callback); };
    const context = vm.createContext({window, document, XMLHttpRequest, URL});
    if (options.bridge) window.fixturePayloadBridge = payload => delivered.push(payload);
    return {
        window, delivered, context,
        evaluate() { return vm.runInContext(script, context); },
        async respond(payload, url = "/api/v1/manga") {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", url);
            xhr.send();
            xhr.responseText = JSON.stringify(payload);
            xhr.listeners.get("load")?.call(xhr);
        },
    };
}

// Android evaluateJavascript returns a JSON-encoded JS value. This exercises
// the actual capture script and that documented boundary; it is not an iOS
// runtime test or a reimplementation of the extension's Kotlin DTO parser.
function receiveEvaluation(rawResult) {
    const encodedResult = JSON.stringify(rawResult ?? null);
    const decoded = JSON.parse(encodedResult);
    return typeof decoded === "string" ? decoded : undefined;
}

test("Kotlin consumes returned browse payload instead of discarding evaluateJs results", () => {
    const helper = kotlin.match(/fun capturePayload\(\)\s*\{([\s\S]*?)\n\s*\}\n\s*\}/)?.[1];
    assert.ok(helper, "capture callback helper must exist");
    assert.match(helper, /evaluateJs\(captureScript\)\s*\{/);
    assert.match(helper, /parseAs<SearchResponse>/, "validate browse response before completing");
    assert.match(helper, /takeIf\s*\{\s*it\.isString\s*\}/, "JSON null or nonstring evaluations must not complete the request");
    assert.match(helper, /resolve\(/, "returned payload must reach request completion");
});

test("initial data captured before bridge installation survives and returns through evaluateJs", () => {
    const f = fixture({initialData: JSON.stringify({queries: {browse: listing}})});
    assert.equal(f.window.fixturePayloadBridge, undefined);
    const first = receiveEvaluation(f.evaluate());
    assert.deepEqual(JSON.parse(first), listing);
    assert.deepEqual(f.delivered, []);
    const cached = receiveEvaluation(f.evaluate());
    assert.equal(cached, first);
    assert.deepEqual(JSON.parse(cached), listing);
});

test("a cached payload still returns when the bridge throws", () => {
    const f = fixture({initialData: JSON.stringify({queries: {browse: listing}})});
    f.window.fixturePayloadBridge = () => { throw new Error("fixture bridge not ready"); };
    const payload = receiveEvaluation(f.evaluate());
    assert.deepEqual(JSON.parse(payload), listing);
    assert.equal(receiveEvaluation(f.evaluate()), payload);
});

test("ordinary bridge delivery and returned payload contain the same complete response", () => {
    const f = fixture({initialData: JSON.stringify({queries: {browse: listing}}), bridge: true});
    const payload = receiveEvaluation(f.evaluate());
    assert.equal(f.delivered.length, 1);
    assert.equal(f.delivered[0], payload);
    assert.deepEqual(JSON.parse(payload), listing);
});

test("no data yet yields null instead of a false successful empty listing", () => {
    const f = fixture();
    assert.equal(receiveEvaluation(f.evaluate()), undefined);
    assert.equal(receiveEvaluation(f.evaluate()), undefined);
    assert.equal(f.window.__comixBrowsePayload, undefined);
});

test("malformed initial data does not prevent a later valid response from returning", async () => {
    const f = fixture({initialData: "{ incomplete"});
    assert.equal(receiveEvaluation(f.evaluate()), undefined);
    await f.respond(listing);
    assert.deepEqual(JSON.parse(receiveEvaluation(f.evaluate())), listing);
});

test("a valid empty API search response can complete without an early bridge", async () => {
    const f = fixture({keyword: "missing fixture"});
    assert.equal(receiveEvaluation(f.evaluate()), undefined);
    const empty = {result: {items: [], meta: {page: 1, last_page: 1}}};
    await f.respond(empty, "/api/v1/manga?keyword=missing%20fixture");
    assert.deepEqual(JSON.parse(receiveEvaluation(f.evaluate())), empty);
});

test("unrelated API responses cannot satisfy an active keyword search", async () => {
    const f = fixture({keyword: "wanted fixture"});
    f.evaluate();
    await f.respond(listing, "/api/v1/manga?keyword=other");
    assert.equal(receiveEvaluation(f.evaluate()), undefined);
    await f.respond(listing, "/api/v1/manga?keyword=wanted%20fixture");
    assert.deepEqual(JSON.parse(receiveEvaluation(f.evaluate())), listing);
});
