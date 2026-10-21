const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Execute only our shipped collector. Discovery, client methods, and API data are
// hand-authored fixtures; these tests do not run downloaded site scripts or prove
// that a particular browser session can pass the site's request checks.
const source = fs.readFileSync(path.join(__dirname, "../assets/chapters.js"), "utf8");
const chapter = (id, number = id) => ({
    id, number, url: `/title/abc-example/${id}-chapter-${number}`,
    name: `Chapter ${number}`, created_at: 1700000000 + id,
    group: {id: 4725, name: "Example group"}, votes: 12,
});
const records = count => Array.from({length: count}, (_, i) => chapter(count - i));
const ids = items => items.map(item => item.id);
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(items = records(1), options = {}) {
    const f = {calls: [], discoveryCalls: 0, callbacks: 0, maxActive: 0, active: 0};
    const transport = {
        async get(requestPath, requestOptions) {
            assert.equal(this, transport, "GET must keep its original owner");
            const params = clone(requestOptions.params);
            f.calls.push({path: requestPath, params});
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
            }
        },
    };
    const originalGet = transport.get;
    const mapChapter = item => ({mappedOnly: item.id});
    // Deliberately use a compact, hand-authored method, preserving the structural
    // clues discovery recognizes. The mapper discards fields so using the mapped
    // return instead of captured raw GET records would fail the assertions.
    const client = {
        before: options.before,
        skipRequest: options.skipRequest,
        async chapters(id,params={}){assert.equal(this,client);if(this.before)await this.before(transport,params);if(this.skipRequest)return null;return ((a)=>({items:a.items.map(mapChapter),meta:a.meta}))(await transport.get(`/manga/${id}/chapters`,{params:params}));},
    };
    const entries = [
        {owner: {other() {}}, key: "other", value() {}},
        {owner: client, key: "chapters", value: client.chapters},
        {owner: transport, key: "get", value: originalGet},
    ].filter(entry => entry.key !== options.missing);
    // The shipped discovery API returns a finder that must be invoked and awaited.
    const discover = callback => async () => {
        f.discoveryCalls++;
        return callback(entries, candidate => candidate === originalGet);
    };
    const document = {
        title: options.title ?? "Example - Comix",
        querySelector(selector) {
            assert.equal(selector, "script#initial-data");
            return options.initialData === undefined ? null : {textContent: options.initialData};
        },
    };
    const forbiddenTimer = () => { throw new Error("Collector must not add artificial timer delays"); };
    const context = vm.createContext({document, setTimeout: forbiddenTimer, setInterval: forbiddenTimer});
    const collect = vm.runInContext(`(${source})`, context);
    f.run = async (snapshotIds = []) => {
        let result;
        let failure;
        const checkRestored = () => {
            f.callbacks++;
            assert.equal(transport.get, originalGet, "GET must be restored before notifying the host");
        };
        await collect(discover, "abc", "/title/abc-", snapshotIds,
            payload => { checkRestored(); result = JSON.parse(payload); },
            message => { checkRestored(); failure = message; });
        assert.equal(f.callbacks, 1, "Notify the host exactly once");
        assert.equal(transport.get, originalGet);
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
    assert.deepEqual(f.calls.map(call => call.params), [1, 2, 3].map(page => ({page, limit: 100, order: {created_at: "desc"}, v: "0"})));
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
