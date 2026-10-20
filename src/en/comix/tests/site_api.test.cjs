// Run with: node --experimental-vm-modules --test src/en/comix/tests/*.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../assets/site_api.js"), "utf8");
const pagesScript = fs.readFileSync(path.join(__dirname, "../assets/chapter_pages.js"), "utf8");
const base = "https://comix.to/assets/build/example/dist/";
const main = `${base}main-example.js`;
const chunk = `${base}client-example.js`;
const pending = Symbol("pending");

function createRuntime({ resources = [main], elements = [], exports = {}, readyState = "complete" } = {}) {
    const imports = [];
    const context = vm.createContext({
        URL,
        Date: { now: () => Date.now() * 100 },
        setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds / 100),
        performance: { getEntriesByType: () => resources.map((name) => ({ name })) },
        document: {
            baseURI: "https://comix.to/title/example/12345-chapter-1",
            querySelectorAll: () => elements,
            readyState,
        },
        window: {},
    });
    const compiled = new vm.Script(`(${script})`, {
        importModuleDynamically: async (url) => {
            imports.push(url);
            const exported = exports[url];
            if (exported === pending) return new Promise(() => {});
            if (exported instanceof Error) throw exported;
            if (!exported) throw new Error("Unknown fixture module");
            const module = new vm.SyntheticModule(Object.keys(exported), function () {
                for (const [key, value] of Object.entries(exported)) this.setExport(key, value);
            }, { context });
            await module.link(() => {});
            await module.evaluate();
            return module;
        },
    });
    const siteApi = compiled.runInContext(context);
    const findGet = siteApi((members, isGet) => members.find((member) => isGet(member.value)));
    return { context, imports, siteApi, findGet };
}

function clientFixture() {
    const calls = [];
    const pages = { baseUrl: "https://images.example", items: [{ url: "one.webp", s: 1 }] };
    const transport = {
        async get(url, config) {
            calls.push({ url, config });
            return { data: pages };
        },
    };
    const client = { request: async (url, config) => (await transport.get(url, config)).data };
    return { client, pages, calls };
}

test("reads a chapter using the real discovery script and unchanged GET matcher", async () => {
    const { client, pages, calls } = clientFixture();
    const runtime = createRuntime({ exports: { [main]: { client } } });
    const chapterPages = vm.runInContext(`(${pagesScript})`, runtime.context);
    const result = await new Promise((resolve, reject) => {
        chapterPages(runtime.siteApi, 12345, resolve, reject);
    });
    assert.deepEqual(JSON.parse(result), pages);
    assert.equal(calls[0].url, "/chapters/12345");
    assert.deepEqual(runtime.imports, [main]);
});

test("discovers document scripts and modulepreloads when Resource Timing is empty", async () => {
    const { client } = clientFixture();
    const runtime = createRuntime({
        resources: [],
        elements: [{ src: main }, { href: chunk }],
        exports: { [main]: {}, [chunk]: { client } },
    });
    assert.equal((await runtime.findGet()).value, client.request);
    assert.deepEqual(runtime.imports, [main, chunk]);
});

test("handles query strings and relative DOM URLs without importing duplicate URLs", async () => {
    const { client } = clientFixture();
    const versionedMain = `${main}?v=123`;
    const runtime = createRuntime({
        resources: [versionedMain],
        elements: [{ src: "/assets/build/example/dist/main-example.js?v=123" }],
        exports: { [versionedMain]: { client } },
    });
    assert.equal((await runtime.findGet()).value, client.request);
    assert.deepEqual(runtime.imports, [versionedMain]);
});

test("continues after a failed import and ignores assets outside the entry directory", async () => {
    const { client } = clientFixture();
    const runtime = createRuntime({
        resources: [main, chunk, "https://comix.to/assets/unrelated.js"],
        exports: { [main]: new Error("Module unavailable"), [chunk]: { client } },
    });
    assert.equal((await runtime.findGet()).value, client.request);
    assert.deepEqual(runtime.imports, [main, chunk]);
});

test("a stalled import cannot block a working module", async () => {
    const { client } = clientFixture();
    const runtime = createRuntime({
        resources: [main, chunk],
        exports: { [main]: pending, [chunk]: { client } },
    });
    assert.equal((await runtime.findGet()).value, client.request);
});

test("reports missing main script with both discovery counts", async () => {
    const runtime = createRuntime({ resources: [chunk], elements: [{ href: chunk }] });
    await assert.rejects(runtime.findGet(), /Comix API v56: no main script \(res=1 dom=1\)/);
    assert.equal(runtime.imports.length, 0);
});

test("reports failed and pending imports within the discovery deadline", { timeout: 2000 }, async () => {
    const runtime = createRuntime({
        resources: [main, chunk],
        exports: { [main]: new Error("Module unavailable"), [chunk]: pending },
    });
    await assert.rejects(runtime.findGet(), /modules unavailable \(res=2 dom=0 load=0 fail=1 wait=1\)/);
    assert.deepEqual(runtime.imports, [main, chunk]);
});

test("reports matcher failures without changing which function is considered a GET helper", async () => {
    const transport = { get: async () => ({ data: null }) };
    const client = { request: async (url) => { return (await transport.get(url)).data; } };
    const runtime = createRuntime({ exports: { [main]: { client } } });
    await assert.rejects(runtime.findGet(), /GET helper missing .*fn=1 root=0 get=0 call=1 data=0/);
});

test("counts direct function exports without treating read-only exports as mutable API members", async () => {
    const { client } = clientFixture();
    const runtime = createRuntime({ exports: { [main]: { request: client.request } } });
    await assert.rejects(runtime.findGet(), /GET helper missing .*fn=0 root=1 get=0 call=0 data=0/);
});

test("preserves useful discovery failures through the chapter page error handler", async () => {
    const runtime = createRuntime({ resources: [] });
    runtime.context.document.querySelector = () => null;
    runtime.context.window.location = { pathname: "/title/example/12345-chapter-1" };
    const chapterPages = vm.runInContext(`(${pagesScript})`, runtime.context);
    const result = await new Promise((resolve) => {
        chapterPages(runtime.siteApi, 12345, () => assert.fail("Unexpected pages"), resolve);
    });
    assert.match(result, /^Comix API v56: no main script.*; Reader did not expose a complete long-strip page list$/);
});
