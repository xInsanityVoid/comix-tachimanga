const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Only the shipped diagnostic runs here. DOM and timing entries are local
// fixtures, not downloaded pages or proof of server acceptance.
const source = fs.readFileSync(path.join(__dirname, "../assets/document-state.js"), "utf8");
const fields = ["body", "bridge", "browsePayload", "initialData", "kind", "ready", "scripts", "status"];
const secret = "fixture-private-value-must-not-be-exported";

function inspect(options = {}) {
    const accessed = [];
    const forbidden = name => ({get() { accessed.push(name); throw new Error(`Read forbidden: ${name}`); }});
    const nodes = new Map(Object.entries(options.nodes || {}));
    if (options.initialData) nodes.set("script#initial-data", {textContent: secret});
    const body = {};
    Object.defineProperties(body, {
        textContent: forbidden("body.textContent"), innerText: forbidden("body.innerText"),
        innerHTML: forbidden("body.innerHTML"), outerHTML: forbidden("body.outerHTML"),
    });
    const document = {
        title: options.title ?? secret,
        readyState: options.readyState ?? "complete",
        body: options.body === false ? null : body,
        scripts: {length: options.scriptCount ?? 7},
        querySelector(selector) {
            return selector.split(",").map(part => nodes.get(part.trim())).find(Boolean) || null;
        },
    };
    Object.defineProperties(document, {
        cookie: forbidden("document.cookie"), URL: forbidden("document.URL"),
        documentURI: forbidden("document.documentURI"), referrer: forbidden("document.referrer"),
    });
    const window = {};
    if (options.bridge) window.fixturePayloadBridge = () => {};
    if (options.cached !== undefined) window.__comixBrowsePayload = options.cached;
    Object.defineProperties(window, {
        localStorage: forbidden("localStorage"), sessionStorage: forbidden("sessionStorage"),
    });
    const globals = {
        document, window,
        location: new URL(options.url || `https://comix.to/title/${secret}?token=${secret}#${secret}`),
        navigator: {userAgent: secret},
    };
    if (options.performance !== false) globals.performance = {
        getEntriesByType(type) {
            assert.equal(type, "navigation");
            return options.entries ?? [{name: `https://comix.to/?token=${secret}`, responseStatus: options.status}];
        },
    };
    window.performance = globals.performance;
    const context = vm.createContext(globals);
    const fn = vm.runInContext(`(${source})`, context);
    const raw = fn("fixturePayloadBridge");
    assert.equal(typeof raw, "string");
    const state = JSON.parse(raw);
    assert.deepEqual(Object.keys(state).sort(), fields);
    assert.ok(!raw.includes(secret), "raw private page values must never leave the diagnostic");
    assert.deepEqual(accessed, [], "diagnostic must not read cookies, storage, or body content");
    return state;
}

test("returns only fixed-schema facts without page, URL, body, or session values", () => {
    assert.deepEqual(inspect({initialData: true, status: 200, bridge: true, cached: secret}), {
        ready: "COMPLETE", kind: "CONTENT", status: 200, body: true,
        initialData: true, scripts: 7, bridge: true, browsePayload: true,
    });
});

test("recognizes the exact third-party block page without returning its title", () => {
    const state = inspect({title: "Third-party apps are not supported"});
    assert.equal(state.kind, "THIRD_PARTY_BLOCK");
    assert.equal(state.status, 0);
});

test("does not label arbitrary text mentioning a block or 503 as a verified HTTP failure", () => {
    const state = inspect({title: "Example story: Third-party apps are not supported / HTTP 503"});
    assert.equal(state.kind, "UNKNOWN");
    assert.equal(state.status, 0);
});

for (const title of ["Just a moment...", "Just a moment…"]) {
    test(`recognizes the known challenge title ${JSON.stringify(title)}`, () => {
        assert.equal(inspect({title}).kind, "CLOUDFLARE_CHALLENGE");
    });
}

for (const selector of ["#challenge-running", "#challenge-form"]) {
    test(`recognizes a challenge marker ${selector}`, () => {
        assert.equal(inspect({nodes: {[selector]: {}}}).kind, "CLOUDFLARE_CHALLENGE");
    });
}

test("reports HTTP503 only when the main navigation exposes status503", () => {
    const state = inspect({status: 503});
    assert.equal(state.kind, "HTTP_503");
    assert.equal(state.status, 503);
});

test("a completed Cloudflare503 challenge remains a challenge, allowing it to finish", () => {
    for (const options of [{title: "Just a moment..."}, {nodes: {"#challenge-form": {}}}]) {
        const state = inspect({...options, status: 503});
        assert.equal(state.ready, "COMPLETE");
        assert.equal(state.kind, "CLOUDFLARE_CHALLENGE");
        assert.equal(state.status, 503);
    }
});

test("HTTP503 while loading remains distinguishable from a completed failure", () => {
    const state = inspect({readyState: "loading", status: 503});
    assert.equal(state.ready, "LOADING");
    assert.equal(state.kind, "HTTP_503");
    const kotlin = fs.readFileSync(path.join(__dirname, "../src/eu/kanade/tachiyomi/extension/en/comix/Comix.kt"), "utf8");
    assert.match(kotlin, /state\.ready == DocumentReady\.COMPLETE && state\.kind == DocumentKind\.HTTP_503\s*->\s*reject\(/,
        "an incomplete503 or challenge must not trigger the completed-error branch");
});

test("loaded site content with unavailable status remains HTTP-unknown", () => {
    const state = inspect({initialData: true});
    assert.equal(state.ready, "COMPLETE");
    assert.equal(state.kind, "CONTENT");
    assert.equal(state.status, 0);
});

test("does not invent HTTP status when navigation timing is unavailable", () => {
    assert.equal(inspect({performance: false}).status, 0);
    assert.equal(inspect({entries: []}).status, 0);
});

test("rejects noninteger, out-of-range, and string navigation status values", () => {
    for (const status of [0, -1, 99, 600, 503.5, "503", NaN, Infinity]) {
        const state = inspect({status});
        assert.equal(state.status, 0, `invalid status ${String(status)}`);
        assert.equal(state.kind, "UNKNOWN");
    }
});

test("about:blank while loading stays an incomplete unknown document", () => {
    const state = inspect({url: "about:blank", title: "", readyState: "loading", body: false, scriptCount: 0});
    assert.equal(state.ready, "LOADING");
    assert.equal(state.kind, "UNKNOWN");
    assert.equal(state.status, 0);
    assert.equal(state.body, false);
});

test("keeps readiness separate from a block title during navigation", () => {
    const state = inspect({readyState: "loading", title: "Third-party apps are not supported"});
    assert.equal(state.ready, "LOADING");
    assert.equal(state.kind, "THIRD_PARTY_BLOCK");
});

test("normalizes readiness and bounds script counts", () => {
    assert.equal(inspect({readyState: "interactive"}).ready, "INTERACTIVE");
    assert.equal(inspect({readyState: secret}).ready, "UNKNOWN");
    assert.equal(inspect({scriptCount: 20000}).scripts, 10000);
});

test("distinguishes absent bridge and cached browse payload from available ones", () => {
    const missing = inspect();
    assert.equal(missing.bridge, false);
    assert.equal(missing.browsePayload, false);
    const present = inspect({bridge: true, cached: secret});
    assert.equal(present.bridge, true);
    assert.equal(present.browsePayload, true);
});
