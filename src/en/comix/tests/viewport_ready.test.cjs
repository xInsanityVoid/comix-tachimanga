const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../assets/viewport_ready.js"), "utf8");
function host(width, height, layout) {
    let now = 0;
    const window = {innerWidth: width, innerHeight: height};
    const ready = vm.runInNewContext(`(${script})`, {
        window, Date: {now: () => now},
        setTimeout: (callback, delay) => { now += delay; layout?.(window, now); callback(); },
    });
    return {ready, elapsed: () => now};
}

test("an already sized browser can start immediately", async () => {
    const browser = host(360, 640);
    await browser.ready();
    assert.equal(browser.elapsed(), 0);
});

test("startup waits for both browser dimensions after native layout", async () => {
    const browser = host(0, 0, (window, now) => {
        if (now >= 100) window.innerWidth = 360;
        if (now >= 200) window.innerHeight = 640;
    });
    await browser.ready();
    assert.equal(browser.elapsed(), 200);
});

test("zero or invalid browser dimensions fail within five seconds without starting page controls", async () => {
    for (const [width, height] of [[0, 640], [360, 0], [NaN, 640], [360, Infinity], [-1, 640]]) {
        const browser = host(width, height);
        let operated = false;
        await assert.rejects(async () => { await browser.ready(); operated = true; }, /browser viewport stayed/);
        assert.equal(operated, false);
        assert.equal(browser.elapsed(), 5000);
    }
});

function bootstrapHost(layout, requiresNativeInput = true) {
    const source = fs.readFileSync(path.join(__dirname, "../src/eu/kanade/tachiyomi/extension/en/comix/Comix.kt"), "utf8");
    let bootstrap = source.match(/val bootstrapScript = """([\s\S]*?)"""\.trimIndent\(\)/)[1]
        .replace('${asset("viewport_ready.js")}', script)
        .replace('${pageScript(passPayloadName, rejectName, touchName)}', 'window.controlsStarted = true;')
        .replaceAll('$startFlagName', 'window.started')
        .replaceAll('$requiresNativeInput', String(requiresNativeInput));
    for (const name of ['passPayloadName', 'bridgeName', 'rejectName', 'errorBridgeName', 'touchName', 'touchBridgeName']) {
        bootstrap = bootstrap.replaceAll('$' + name, name);
    }
    const errors = [];
    const window = {innerWidth: 0, innerHeight: 0, errorBridgeName: {post: error => errors.push(error)}};
    window.top = window;
    let now = 0;
    const completion = vm.runInNewContext(bootstrap, {
        window, localStorage: {setItem() {}}, Date: {now: () => now},
        setTimeout: (callback, delay) => { now += delay; layout?.(window, now); callback(); },
    });
    return {window, errors, completion};
}

test("production bootstrap waits for layout before starting chapter controls", async () => {
    const browser = bootstrapHost((window, now) => {
        if (now >= 150) { window.innerWidth = 360; window.innerHeight = 640; }
    });
    assert.equal(browser.window.controlsStarted, undefined);
    await browser.completion;
    assert.equal(browser.window.controlsStarted, true);
    assert.deepEqual(browser.errors, []);
});

test("production bootstrap reports an unsupported viewport through the error bridge", async () => {
    const browser = bootstrapHost();
    await browser.completion;
    assert.equal(browser.window.controlsStarted, undefined);
    assert.equal(browser.errors.length, 1);
    assert.match(browser.errors[0], /Comix63: browser viewport stayed 0x0 after layout/);
});

test("browse bootstrap runs immediately even when host dimensions remain zero", async () => {
    const browser = bootstrapHost(undefined, false);
    assert.equal(browser.window.controlsStarted, true);
    await browser.completion;
    assert.deepEqual(browser.errors, []);
    assert.equal(browser.window.innerWidth, 0);
});
