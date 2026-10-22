const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../assets/connection-check.js"), "utf8");
const ua = "Mozilla/5.0 fixture Safari/604.1";
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({runtimeUa = ua, fetchImpl, unavailable = false} = {}) {
    const calls = [];
    let timer;
    let cleared = false;
    const globals = {
        window: {}, navigator: {userAgent: runtimeUa}, AbortController,
        setTimeout(fn, delay) { assert.equal(delay, 2000); timer = fn; return 1; },
        clearTimeout() { cleared = true; },
        fetch: unavailable ? undefined : (...args) => {
            calls.push(args);
            return fetchImpl ? fetchImpl(...args) : Promise.resolve({
                status: 200, ok: true,
                text: async () => `ip=PRIVATE_IP\nloc=PRIVATE_LOCATION\nuag=${ua}\ntls=TLSv1.3\n`,
            });
        },
    };
    for (const name of ["document", "localStorage", "sessionStorage"]) {
        Object.defineProperty(globals, name, {get() { throw new Error("Forbidden access " + name); }});
    }
    const fn = vm.runInNewContext(`(${source})`, globals);
    const read = configured => JSON.parse(fn(configured ?? ua));
    return {read, calls, timeout: () => timer(), cleared: () => cleared};
}

test("measures runtime and echoed UA once without exporting other trace fields", async () => {
    const h = harness();
    assert.equal(h.read().phase, "PENDING");
    assert.equal(h.read().phase, "PENDING");
    await flush();
    const result = h.read();
    assert.deepEqual(result, {phase: "COMPLETE", runtimeUa: ua, echoedUa: ua, runtimeMatches: true, echoedMatches: true, status: 200});
    assert.equal(h.calls.length, 1);
    const [url, options] = h.calls[0];
    assert.equal(url, "/cdn-cgi/trace");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
    assert.equal(h.cleared(), true);
});

test("distinguishes configured, runtime and transmitted identities", async () => {
    const h = harness({runtimeUa: "Different embedded UA"});
    assert.equal(h.read().runtimeMatches, false);
    await flush();
    assert.equal(h.read().echoedMatches, false);
});

test("timeout aborts the request and late completion cannot replace its result", async () => {
    let finish;
    const h = harness({fetchImpl: () => new Promise(resolve => { finish = resolve; })});
    h.read();
    h.timeout();
    assert.equal(h.calls[0][1].signal.aborted, true);
    finish({status: 200, ok: true, text: async () => `uag=${ua}`});
    await flush();
    assert.equal(h.read().phase, "TIMEOUT");
    assert.equal(h.read().echoedMatches, null);
    assert.equal(h.calls.length, 1);
});

test("HTTP rejection is not misreported as a UA mismatch and body is not read", async () => {
    const h = harness({fetchImpl: async () => ({status: 503, ok: false, text() { throw new Error("must not read"); }})});
    h.read();
    await flush();
    assert.equal(h.read().phase, "HTTP_ERROR");
    assert.equal(h.read().status, 503);
    assert.equal(h.read().echoedMatches, null);
});

test("network failure and missing fetch remain explicit unknown results", async () => {
    const h = harness({fetchImpl: async () => { throw new Error("private error data"); }});
    h.read();
    await flush();
    assert.equal(h.read().phase, "NETWORK_ERROR");
    assert.equal(h.read().echoedMatches, null);
    const unavailable = harness({unavailable: true});
    assert.equal(unavailable.read().phase, "UNAVAILABLE");
    assert.equal(unavailable.calls.length, 0);
});

test("missing or malformed echo does not export arbitrary text", async () => {
    for (const body of ["ip=PRIVATE_IP\n", "uag=" + "x".repeat(513), "uag=bad\u0000value"]) {
        const h = harness({fetchImpl: async () => ({status: 200, ok: true, text: async () => body})});
        h.read();
        await flush();
        assert.equal(h.read().phase, "NO_UA");
        assert.equal(h.read().echoedUa, "");
        assert.equal(h.read().echoedMatches, null);
    }
});

test("invalid runtime UA remains unknown even when echoed identity is available", async () => {
    const h = harness({runtimeUa: "x".repeat(513)});
    h.read();
    await flush();
    assert.equal(h.read().runtimeUa, "");
    assert.equal(h.read().runtimeMatches, null);
    assert.equal(h.read().echoedMatches, null);
});
