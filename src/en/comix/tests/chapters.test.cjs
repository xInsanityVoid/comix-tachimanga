const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Execute only our shipped collector. Discovery, client methods, and API data are
// hand-authored fixtures; these tests do not run downloaded site scripts or prove
// that a particular browser session can pass the site's request checks.
// Full suite, including the shipped vendor's dynamic-import integration:
// node --experimental-vm-modules --test src/en/comix/tests/chapters.test.cjs
const source = fs.readFileSync(path.join(__dirname, "../assets/chapters.js"), "utf8");
const vendorSource = fs.readFileSync(path.join(__dirname, "../assets/vendor.js"), "utf8");
const chapter = (id, number = id) => ({
    id, number, url: `/title/abc-example/${id}-chapter-${number}`,
    name: `Chapter ${number}`, created_at: 1700000000 + id,
    group: {id: 4725, name: "Example group"}, votes: 12,
});
const records = count => Array.from({length: count}, (_, i) => chapter(count - i));
const ids = items => items.map(item => item.id);
const clone = value => JSON.parse(JSON.stringify(value));

// Model exports whose callable properties work but cannot be enumerated or
// identified through native bound-function strings. Vendor recovery must use
// source clues while preserving these actual owner and method identities.
function opaqueOwner(target) {
    const bound = new Map();
    return new Proxy(target, {
        ownKeys() { return []; },
        get(owner, key, receiver) {
            const value = Reflect.get(owner, key, receiver);
            if (typeof value !== "function") return value;
            if (!bound.has(value)) bound.set(value, value.bind(receiver));
            return bound.get(value);
        },
    });
}

function fixture(items = records(1), options = {}) {
    const f = {
        calls: [], methodCalls: [], wireCalls: [], initializerCalls: [],
        discoveryCalls: 0, callbacks: 0, maxActive: 0, active: 0,
        clock: 100000, stickyFlag: !!options.stickyFlag, stalePages: 0, markers: new Map(),
    };
    const document = {
        title: options.title ?? "Example - Comix",
        querySelector(selector) {
            assert.equal(selector, "script#initial-data");
            return options.initialData === undefined ? null : {textContent: options.initialData};
        },
    };
    const forbiddenTimer = () => { throw new Error("Collector must not add artificial timer delays"); };
    const context = vm.createContext({
        document, setTimeout: forbiddenTimer, setInterval: forbiddenTimer,
        Date: {now() {
            f.initializerCalls.push(f.clock);
            if (options.initializerError) throw options.initializerError;
            return f.clock;
        }},
    });
    // These are real fixture functions with closure state, not functions whose
    // toString is replaced. Their deliberately arbitrary names must not matter.
    const initializer = vm.runInContext("var activityAt = 0; function renewFixtureState(){activityAt=Date.now()} renewFixtureState", context);
    const secondInitializer = vm.runInContext("var otherActivityAt = 0; function unrelatedTimestamp(){otherActivityAt=Date.now()} unrelatedTimestamp", context);
    const pruneMarkers = () => {
        for (const [key, timestamp] of f.markers) {
            if (f.clock - timestamp > 5000) f.markers.delete(key);
        }
    };
    const recordMethod = (id, params) => {
        f.methodCalls.push({params: clone(params), activityAt: context.activityAt, now: f.clock});
        pruneMarkers();
        f.markers.set(`/manga/${id}/chapters:${params.page}`, f.clock);
    };
    // A hand-authored behavioral model of the independently reviewed two-second
    // activity / five-second request-marker bookkeeping. It is not site code,
    // cryptographic validation, or proof of server/browser-session acceptance.
    const modelRequest = (requestPath, params) => {
        const wireParams = clone(params);
        if (wireParams.v === undefined) {
            const key = `${requestPath}:${params.page}`;
            if (params.page >= 2 && key !== f.previousPage) {
                f.previousPage = key;
                f.stalePages = f.clock - context.activityAt > 2000 ? f.stalePages + 1 : 0;
                if (f.stalePages >= 3) f.stickyFlag = true;
            }
            let missingMarker = false;
            if (params.page >= 2) {
                pruneMarkers();
                const marker = f.markers.get(key);
                f.markers.delete(key);
                missingMarker = marker === undefined || f.clock - marker > 5000;
            }
            wireParams.v = String((missingMarker ? 8 : 0) | (f.stickyFlag ? 1 : 0));
        }
        f.wireCalls.push({params: wireParams, headers: {"X-Rt": f.stickyFlag ? "1" : "0"}});
    };
    const transportTarget = {
        async get(requestPath, requestOptions) {
            assert.equal(this, transport, "GET must keep its original owner");
            const params = clone(requestOptions.params);
            f.calls.push({path: requestPath, params});
            if (options.clientModel) modelRequest(requestPath, params);
            f.active++;
            f.maxActive = Math.max(f.maxActive, f.active);
            try {
                await Promise.resolve();
                const perPage = Math.min(params.limit, options.clamp ?? params.limit);
                const result = {
                    items: items.slice((params.page - 1) * perPage, params.page * perPage),
                    meta: {page: params.page, lastPage: Math.max(1, Math.ceil(items.length / perPage)), total: items.length, perPage},
                };
                return await (options.response ? options.response(params, result, requestPath) : result);
            } finally {
                f.active--;
                f.clock += options.advanceClock ?? 0;
            }
        },
    };
    if (options.vendor) {
        const rawGet = transportTarget.get;
        const backend = {async get(url, config) {
            const effectiveConfig = options.replaceConfigParams ? {...config, params: {...config.params, v: "0"}} : config;
            return {data: await rawGet.call(transport, url, effectiveConfig)};
        }};
        // A hand-authored Axios-like wrapper matches the vendor's actual GET
        // predicate. Its source is also the controlled fetch fixture below.
        transportTarget.get = async(a,b)=>(await backend.get(a,b)).data;
    }
    const transport = options.vendorRecovery ? opaqueOwner(transportTarget) : transportTarget;
    const originalGet = transport.get;
    const mapChapter = item => ({mappedOnly: item.id});
    // Deliberately use a compact, hand-authored method, preserving the structural
    // clues discovery recognizes. The mapper discards fields so using the mapped
    // return instead of captured raw GET records would fail the assertions.
    const clientTarget = {
        before: options.before,
        skipRequest: options.skipRequest,
        async chapters(id,params={}){assert.equal(this,client);recordMethod(id,params);if(this.before)await this.before(transport,params);if(this.skipRequest)return null;return ((a)=>({items:a.items.map(mapChapter),meta:a.meta}))(await transport.get(`/manga/${id}/chapters`,{params:params}));},
    };
    const client = options.vendorRecovery ? opaqueOwner(clientTarget) : clientTarget;
    const recoveredGet = function (...args) {
        f.recoveredGetCalls = (f.recoveredGetCalls || 0) + 1;
        return originalGet.apply(this, args);
    };
    const discoveredGet = options.recoveredGet ? recoveredGet : originalGet;
    const entries = [
        {owner: {other() {}}, key: "other", value() {}},
        {owner: client, key: "chapters", value: client.chapters},
        {owner: transport, key: "get", value: discoveredGet},
    ].filter(entry => entry.key !== options.missing);
    const namespace = Object.hasOwn(options, "namespace")
        ? options.namespace?.({client, transport, initializer, secondInitializer})
        : {unrelatedExport: 7, mangaService: client, transportService: transport, renamedInitializer: initializer};
    // The shipped discovery API returns a finder that must be invoked and awaited.
    let discover = callback => async () => {
        f.discoveryCalls++;
        return callback(entries, candidate => candidate === discoveredGet, namespace);
    };
    if (options.vendor) {
        const moduleUrl = "https://fixture.invalid/assets/main-fixture.js";
        f.imports = [];
        f.fetches = [];
        context.performance = {getEntriesByType(type) {
            assert.equal(type, "resource");
            return [{name: moduleUrl}];
        }};
        context.fetch = async url => {
            assert.equal(url, moduleUrl);
            f.fetches.push(url);
            // Text is parsed by the shipped vendor, never executed. All source
            // comes from the hand-authored fixture functions above.
            return {text: async () => `const client={${clientTarget.chapters.toString()}};const transport={get:${transportTarget.get.toString()}};`};
        };
        let fixtureModule;
        discover = vm.runInContext(vendorSource, context, {importModuleDynamically: async url => {
            assert.equal(url, moduleUrl);
            f.imports.push(url);
            fixtureModule ??= new vm.SyntheticModule(Object.keys(namespace), function () {
                for (const [key, value] of Object.entries(namespace)) this.setExport(key, value);
            }, {context, identifier: moduleUrl});
            if (fixtureModule.status === "unlinked") await fixtureModule.link(() => { throw new Error("No fixture dependencies"); });
            if (fixtureModule.status === "linked") await fixtureModule.evaluate();
            return fixtureModule;
        }});
    }
    const collect = vm.runInContext(`(${source})`, context);
    const assertRestored = () => {
        // A Proxy may bind on every property read. Compare the value actually
        // restored to its backing property, then verify call behavior below.
        assert.equal(options.vendorRecovery ? transportTarget.get : transport.get, originalGet,
            "GET must be restored before notifying the host");
    };
    f.requestAfterRun = () => transport.get("/manga/abc/chapters", {params: {page: 1, limit: 100}});
    f.run = async (snapshotIds = []) => {
        let result;
        let failure;
        const checkRestored = () => {
            f.callbacks++;
            assertRestored();
        };
        await collect(discover, "abc", "/title/abc-", snapshotIds,
            payload => { checkRestored(); result = JSON.parse(payload); },
            message => { checkRestored(); failure = message; });
        assert.equal(f.callbacks, 1, "Notify the host exactly once");
        assertRestored();
        if (failure !== undefined) throw new Error(failure);
        return result;
    };
    return f;
}

test("collects every raw chapter in sequential 100-item requests without artificial delays", async () => {
    const items = records(231);
    const f = fixture(items);
    const result = await f.run();
    assert.deepEqual(result.chapters, items);
    assert.deepEqual(result.chapterIds, ids(items));
    assert.equal(result.complete, true);
    assert.equal(result.incremental, false);
    assert.equal(result.total, 231);
    assert.equal(f.discoveryCalls, 1);
    assert.equal(f.maxActive, 1);
    assert.deepEqual(f.calls.map(call => call.path), Array(3).fill("/manga/abc/chapters"));
    assert.deepEqual(f.calls.map(call => call.params), [1, 2, 3].map(page => ({page, limit: 100, order: {created_at: "desc"}})));
});

test("honors a server clamp of 20 instead of treating a short requested batch as the last page", async () => {
    const f = fixture(records(45), {clamp: 20});
    const result = await f.run();
    assert.equal(result.chapters.length, 45);
    assert.deepEqual(f.calls.map(call => call.params.page), [1, 2, 3]);
    assert.ok(f.calls.every(call => call.params.limit === 100));
    assert.equal(f.maxActive, 1);
});

test("accepts a complete zero-chapter API response without inventing chapters", async () => {
    const result = await fixture([]).run();
    assert.deepEqual(result, {chapters: [], complete: true, incremental: false, chapterIds: [], total: 0, queries: null});
});

test("stops at a known snapshot only when its union accounts for the declared total", async () => {
    const f = fixture(records(243));
    const result = await f.run(ids(records(240)));
    assert.equal(f.calls.length, 1);
    assert.equal(result.incremental, true);
    assert.equal(result.complete, true);
    assert.equal(result.chapters.length, 100);
    assert.equal(result.chapterIds.length, 243);
    assert.deepEqual([...result.chapterIds].sort((a, b) => a - b), Array.from({length: 243}, (_, i) => i + 1));
});

test("includes a newly uploaded older chapter number by ordering uploads rather than chapter numbers", async () => {
    const latestUpload = chapter(301, 1.5);
    const f = fixture([latestUpload, ...records(300)]);
    const result = await f.run(ids(records(300)));
    assert.equal(result.incremental, true);
    assert.deepEqual(result.chapters[0], latestUpload);
    assert.deepEqual(f.calls[0].params.order, {created_at: "desc"});
});

test("does not stop just because an incomplete known-ID set overlaps the first page", async () => {
    const items = records(230);
    const f = fixture(items);
    const result = await f.run(ids(items.slice(0, 100)));
    assert.equal(f.calls.length, 3);
    assert.equal(result.incremental, false);
    assert.deepEqual(result.chapters, items);
});

test("new uploads plus removed chapters force a full walk when the old snapshot union is too large", async () => {
    const items = [chapter(151), ...records(149).filter(item => item.id !== 1)];
    const f = fixture(items);
    const result = await f.run(ids(records(150)));
    assert.equal(f.calls.length, 2);
    assert.equal(result.incremental, false);
    assert.deepEqual(result.chapterIds, ids(items));
    assert.ok(!result.chapterIds.includes(1));
    assert.ok(!result.chapterIds.includes(150));
});

test("deletions alone force a full snapshot instead of carrying deleted IDs forward", async () => {
    const f = fixture(records(140));
    const result = await f.run(ids(records(150)));
    assert.equal(f.calls.length, 2);
    assert.equal(result.incremental, false);
    assert.equal(result.chapterIds.length, 140);
});

test("rejects duplicate chapter IDs within a response", async () => {
    await assert.rejects(fixture([chapter(1), chapter(1)]).run(), /repeated chapters/);
});

test("rejects chapter IDs repeated across pages", async () => {
    const items = records(101);
    items[100] = items[0];
    await assert.rejects(fixture(items).run(), /repeated chapters/);
});

for (const page of [1, 2]) {
    test(`rejects a truncated page ${page} rather than reporting a complete result`, async () => {
        const f = fixture(records(101), {response(params, result) {
            if (params.page === page) result.items.pop();
            return result;
        }});
        await assert.rejects(f.run(), new RegExp(`incomplete chapter page ${page}`));
    });
}

test("rejects a total that changes during traversal", async () => {
    const f = fixture(records(231), {response(params, result) {
        if (params.page === 2) result.meta.total++;
        return result;
    }});
    await assert.rejects(f.run(), /chapter list changed while loading/);
    assert.equal(f.calls.length, 2);
});

test("rejects a pagination-size change that changes the last page", async () => {
    const f = fixture(records(231), {response(params, result) {
        if (params.page === 2) Object.assign(result.meta, {perPage: 200, lastPage: 2});
        return result;
    }});
    await assert.rejects(f.run(), /chapter list changed while loading/);
});

for (const [label, change] of [
    ["missing metadata", result => { result.meta = null; }],
    ["wrong page", result => { result.meta.page = 2; }],
    ["wrong last page", result => { result.meta.lastPage = 2; }],
    ["negative total", result => { result.meta.total = -1; }],
    ["zero page size", result => { result.meta.perPage = 0; }],
    ["fractional page size", result => { result.meta.perPage = 1.5; }],
    ["unsafe total", result => { result.meta.total = Number.MAX_SAFE_INTEGER + 1; }],
    ["missing items", result => { delete result.items; }],
]) {
    test(`rejects invalid response: ${label}`, async () => {
        const f = fixture(records(1), {response(params, result) { change(result); return result; }});
        await assert.rejects(f.run(), /invalid chapter pagination/);
    });
}

for (const [label, override] of [
    ["invalid ID", {id: 0}],
    ["non-numeric number", {number: "1"}],
    ["non-finite number", {number: NaN}],
    ["wrong series URL", {url: "/title/other-example/1-chapter-1"}],
]) {
    test(`rejects malformed chapter: ${label}`, async () => {
        await assert.rejects(fixture([{...chapter(1), ...override}]).run(), /invalid chapter pagination/);
    });
}

test("reports HTTP request failures and restores GET before rejecting", async () => {
    const error = Object.assign(new Error("Forbidden"), {response: {status: 403}});
    await assert.rejects(fixture(records(1), {response() { throw error; }}).run(), /HTTP 403/);
});

test("preserves the reason for a request failure without an HTTP status", async () => {
    await assert.rejects(fixture(records(1), {response() { throw new Error("Connection closed"); }}).run(), /Connection closed/);
});

for (const missing of ["chapters", "get"]) {
    test(`fails clearly when discovery cannot find ${missing}`, async () => {
        const f = fixture(records(1), {missing});
        await assert.rejects(f.run(), /Could not find the site's chapters API/);
        assert.equal(f.calls.length, 0);
    });
}

test("rejects a client method that returns without making the chapter request", async () => {
    await assert.rejects(fixture(records(1), {skipRequest: true}).run(), /Chapter page 1 did not return/);
});

test("ignores unrelated GET records while preserving their return values", async () => {
    const f = fixture(records(1), {async before(transport, params) {
        const result = await transport.get("/manga/other/chapters", {params});
        assert.equal(result.items[0].id, 1);
    }});
    const result = await f.run();
    assert.equal(result.chapters.length, 1);
    assert.deepEqual(f.calls.map(call => call.path), ["/manga/other/chapters", "/manga/abc/chapters"]);
});

function concurrentSiteRequest(error) {
    let releaseOwnRequest;
    const ownRequestStarted = new Promise(resolve => { releaseOwnRequest = resolve; });
    let siteRequest;
    const state = {};
    const f = fixture(records(45), {
        before(transport, params) {
            const siteParams = {...params, limit: 20, group_id: 10702};
            assert.notEqual(siteParams, params);
            // Start the site's filtered request without awaiting it. It overlaps
            // our request, then completes first, so its record leads the capture.
            siteRequest = transport.get("/manga/abc/chapters", {params: siteParams}).then(
                result => { state.result = result; },
                failure => { state.error = failure; },
            );
        },
        async response(params, result) {
            if (params.group_id === 10702) {
                await ownRequestStarted;
                if (error) throw error;
                return {items: records(20), meta: {page: 1, lastPage: 1, total: 20, perPage: 20}};
            }
            releaseOwnRequest();
            await siteRequest;
            return result;
        },
    });
    return {f, state};
}

test("does not capture a concurrent filtered UI response with the same page and date sort", async () => {
    const {f, state} = concurrentSiteRequest();
    const result = await f.run();
    assert.equal(f.maxActive, 2, "The site and collector requests must overlap");
    assert.equal(state.result.items.length, 20);
    assert.equal(result.total, 45);
    assert.deepEqual(result.chapters, records(45));
    assert.deepEqual(f.calls.map(call => [call.params.page, call.params.order.created_at]), [[1, "desc"], [1, "desc"]]);
    assert.deepEqual(f.calls.map(call => call.params.limit), [20, 100]);
});

test("ignores a concurrent UI request error when our matching chapter request succeeds", async () => {
    const siteError = Object.assign(new Error("Filtered request forbidden"), {response: {status: 403}});
    const {f, state} = concurrentSiteRequest(siteError);
    const result = await f.run();
    assert.equal(f.maxActive, 2);
    assert.equal(state.error, siteError);
    assert.equal(result.complete, true);
    assert.deepEqual(result.chapters, records(45));
    assert.deepEqual(f.calls.map(call => [call.params.page, call.params.order.created_at]), [[1, "desc"], [1, "desc"]]);
});

test("returns optional initial detail metadata with the actual quoted detail key", async () => {
    const queries = {'["manga","detail","abc"]': {hid: "abc", title: "Example", authors: [{title: "Author"}]}};
    const result = await fixture(records(1), {initialData: JSON.stringify({queries})}).run();
    assert.deepEqual(result.queries, queries);
});

for (const initialData of [undefined, "broken json", "null", "{}"]) {
    test(`does not fail a complete chapter response for absent optional metadata (${String(initialData)})`, async () => {
        const result = await fixture(records(1), {initialData}).run();
        assert.equal(result.queries, null);
        assert.equal(result.complete, true);
    });
}

test("reports the explicit blocked-session page without running API discovery", async () => {
    const f = fixture(records(1), {title: "Third-party apps are not supported"});
    await assert.rejects(f.run(), /blocked this browser session/);
    assert.equal(f.discoveryCalls, 0);
    assert.equal(f.calls.length, 0);
});

test("binds an arbitrarily named initializer to the exact method and GET owners", async () => {
    const f = fixture(records(101), {namespace: ({client, transport, initializer}) => ({
        arbitraryMethodExport: client, arbitraryGetExport: transport, unknownHelperName: initializer,
    })});
    const result = await f.run();
    assert.equal(result.chapters.length, 101);
    assert.equal(f.initializerCalls.length, 2);
    assert.ok(f.methodCalls.every(call => call.activityAt === call.now));
});

test("accepts export aliases of the same initializer without treating them as ambiguity", async () => {
    const f = fixture(records(1), {namespace: ({client, transport, initializer}) => ({
        client, transport, firstAlias: initializer, secondAlias: initializer,
    })});
    await f.run();
    assert.equal(f.initializerCalls.length, 1);
});

for (const [label, namespace] of [
    ["absent namespace", undefined],
    ["missing method owner", ({transport, initializer}) => ({transport, initializer})],
    ["missing GET owner", ({client, initializer}) => ({client, initializer})],
    ["lookalike method owner", ({client, transport, initializer}) => ({client: {...client}, transport, initializer})],
    ["lookalike GET owner", ({client, transport, initializer}) => ({client, transport: {...transport}, initializer})],
    ["owners nested in another export", ({client, transport, initializer}) => ({nested: {client, transport}, initializer})],
]) {
    test(`rejects ${label} before any chapter request`, async () => {
        const f = fixture(records(1), {namespace});
        await assert.rejects(f.run(), /Could not find the site's chapter client module/);
        assert.equal(f.calls.length, 0);
        assert.equal(f.methodCalls.length, 0);
        assert.equal(f.initializerCalls.length, 0);
    });
}

for (const [label, namespace] of [
    ["absent initializer", ({client, transport}) => ({client, transport})],
    ["nested initializer", ({client, transport, initializer}) => ({client, transport, nested: {initializer}})],
    ["ambiguous initializers", ({client, transport, initializer, secondInitializer}) => ({client, transport, initializer, secondInitializer})],
    ["spoofed function string", ({client, transport}) => {
        const fake = () => { throw new Error("Do not call a spoofed function"); };
        fake.toString = () => "function pretend(){activityAt=Date.now()}";
        return {client, transport, fake};
    }],
]) {
    test(`rejects ${label} before any chapter request`, async () => {
        const f = fixture(records(1), {namespace});
        await assert.rejects(f.run(), /Could not find a unique chapter request initializer/);
        assert.equal(f.calls.length, 0);
        assert.equal(f.methodCalls.length, 0);
        assert.equal(f.initializerCalls.length, 0);
    });
}

test("restores GET when the original initializer throws before the chapter method", async () => {
    const f = fixture(records(1), {initializerError: new Error("Fixture initializer failed")});
    await assert.rejects(f.run(), /Fixture initializer failed/);
    assert.equal(f.initializerCalls.length, 1);
    assert.equal(f.methodCalls.length, 0);
    assert.equal(f.calls.length, 0);
});

for (const fail of [false, true]) {
    test(`restores the owner's original GET rather than discovery's recovery wrapper (${fail ? "error" : "success"})`, async () => {
        const f = fixture(records(1), {recoveredGet: true, response(params, result) {
            if (fail) throw new Error("Fixture transport failed");
            return result;
        }});
        if (fail) await assert.rejects(f.run(), /Fixture transport failed/);
        else await f.run();
        assert.equal(f.recoveredGetCalls || 0, 0);
        assert.equal(f.calls.length, 1);
    });
}

test("lets the client compute request flags and initializes every page even after old activity", async () => {
    const f = fixture(records(351), {clientModel: true, advanceClock: 10000});
    const result = await f.run();
    assert.equal(result.chapters.length, 351);
    assert.deepEqual(f.initializerCalls, [100000, 110000, 120000, 130000]);
    assert.ok(f.methodCalls.every(call => !Object.hasOwn(call.params, "v")));
    assert.ok(f.methodCalls.every(call => call.activityAt === call.now));
    assert.deepEqual(f.wireCalls.map(call => call.params.v), ["0", "0", "0", "0"]);
    assert.deepEqual(f.wireCalls.map(call => call.headers["X-Rt"]), ["0", "0", "0", "0"]);
    assert.equal(f.stalePages, 0);
    assert.equal(f.stickyFlag, false);
    assert.equal(f.markers.size, 0, "Later pages consume their markers and the old first-page marker expires");
});

test("the bookkeeping model leaves the first-page marker for expiry rather than consuming it", async () => {
    const f = fixture(records(1), {clientModel: true});
    await f.run();
    assert.deepEqual(f.wireCalls.map(call => call.params.v), ["0"]);
    assert.equal(f.markers.get("/manga/abc/chapters:1"), 100000);
});

test("does not clear an existing sticky client flag or override its header", async () => {
    const f = fixture(records(101), {clientModel: true, stickyFlag: true, advanceClock: 10000});
    await f.run();
    assert.equal(f.initializerCalls.length, 2);
    assert.ok(f.calls.every(call => !Object.hasOwn(call.params, "v")));
    assert.deepEqual(f.wireCalls.map(call => call.params.v), ["1", "1"]);
    assert.deepEqual(f.wireCalls.map(call => call.headers["X-Rt"]), ["1", "1"]);
    assert.equal(f.stickyFlag, true);
});

for (const vendorRecovery of [false, true]) {
    test(`shipped vendor passes the owning namespace through its ${vendorRecovery ? "source-recovery" : "enumeration"} callback`, {
        skip: typeof vm.SyntheticModule !== "function" ? "Run with --experimental-vm-modules for controlled import fixtures" : false,
    }, async () => {
        const f = fixture(records(101), {vendor: true, vendorRecovery});
        const result = await f.run();
        assert.deepEqual(result.chapters, records(101));
        assert.equal(result.complete, true);
        assert.equal(f.imports.length, 1);
        assert.equal(f.fetches.length, vendorRecovery ? 1 : 0);
        assert.equal(f.methodCalls.length, 2);
        assert.ok(f.methodCalls.every(call => call.activityAt === call.now));
        assert.ok(f.methodCalls.every(call => !Object.hasOwn(call.params, "v")));
        const after = await f.requestAfterRun();
        assert.deepEqual(after.items, records(101).slice(0, 100));
    });
}

test("capture survives Axios-style replacement of the internal request config's params", {
    skip: typeof vm.SyntheticModule !== "function" ? "Run with --experimental-vm-modules for controlled import fixtures" : false,
}, async () => {
    const f = fixture(records(101), {vendor: true, replaceConfigParams: true});
    const result = await f.run();
    assert.equal(result.chapters.length, 101);
    assert.ok(f.methodCalls.every(call => !Object.hasOwn(call.params, "v")));
    assert.deepEqual(f.calls.map(call => call.params.v), ["0", "0"]);
});
