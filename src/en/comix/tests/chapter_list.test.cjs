const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const asset = name => fs.readFileSync(path.join(__dirname, "../assets", name), "utf8");
const element = (textContent = "", attrs = {}) => ({ textContent, getAttribute: key => attrs[key] ?? null });

function fixture() {
    const f = { busy: false, group: "All groups", sort: "Sort by date (desc)", search: "",
        hint: "Showing 1 to 2 of 2 items", page: "1", location: "https://comix.to/title/abc-example",
        rows: [row(101, "Ch.12.5", "Bonus"), row(102, "Ch.12", "", 10702)] };
    function row(id, label, name = "", group = 4725) {
        const parts = {
            "a.mchap-row__primary": element(label + (name ? ` — ${name}` : ""), {href: `/title/abc-example/${id}-chapter-12`}),
            ".mchap-row__ch": element(label),
            ".mchap-row__group": element(group === 10702 ? "Official" : "Asura Scans", {href: `/groups/${group}`}),
            ".mchap-row__likes": element("1.2k"), ".mchap-row__time": element("1d ago"),
        };
        return {parts, querySelector: selector => parts[selector]};
    }
    f.section = {
        querySelector(selector) {
            return {
                ".mchap-list": element("", {"aria-busy": f.busy ? "true" : null}),
                ".mpage__group > button": element(f.group), ".mchap-search input": {value: f.search},
                '.mchap-toolbar__sort button[aria-pressed="true"]': element("Date", {title: f.sort}),
                ".mchap-foot__hint": f.hint === null ? null : element(f.hint),
                '.npager [aria-current="page"]': element(f.page),
            }[selector] ?? null;
        },
        querySelectorAll: selector => { assert.equal(selector, ".mchap-item"); return f.rows; },
    };
    const document = {querySelector: selector => { assert.equal(selector, ".mpage__chapters"); return f.section; }};
    const context = vm.createContext({URL, document, window: {get location() { return new URL(f.location); }}});
    const snapshot = vm.runInContext(`(${asset("chapter_list_snapshot.js")})`, context);
    f.read = () => JSON.parse(JSON.stringify(snapshot("/title/abc-")));
    return f;
}

test("rendered rows retain decimal numbers, names, groups, votes and official status", () => {
    const result = fixture().read();
    assert.equal(result.status, "ready");
    assert.equal(result.total, 2);
    assert.deepEqual(result.chapters[0], {id:101, url:"/title/abc-example/101-chapter-12", number:12.5,
        name:"Bonus", votes:1200, createdAtFormatted:"1d ago", group:{name:"Asura Scans",id:4725},isOfficial:false});
    assert.equal(result.chapters[1].isOfficial, true);
});
test("a loading page cannot return the previous page's rows", () => {
    const f = fixture(); f.busy = true; assert.equal(f.read().status, "waiting");
});
test("partial rendering and missing footer never become complete lists", () => {
    const f = fixture(); f.rows.pop(); assert.equal(f.read().status, "waiting");
    f.hint = null; assert.equal(f.read().status, "waiting");
});
test("only all groups in newest upload order can be captured", () => {
    const f = fixture(); f.group = "Asura Scans"; assert.equal(f.read().status, "waiting");
    f.group = "All groups"; f.sort = "Sort by chapter (desc)"; assert.equal(f.read().status, "waiting");
    f.sort = "Sort by date (desc)"; f.search = "123"; assert.equal(f.read().status, "error");
});
test("rejects a different series, foreign link, invalid chapter and duplicate row", () => {
    const f = fixture(); f.location = "https://comix.to/title/other-title"; assert.equal(f.read().status, "error");
    f.location = "https://comix.to/title/abc-example";
    f.rows[0].parts["a.mchap-row__primary"] = element("Ch.1",{href:"https://other.example/title/abc-example/1-chapter-1"});
    assert.match(f.read().error, /different series/);
    f.rows[0] = f.rows[1]; assert.match(f.read().error, /Duplicate/);
    f.rows.pop(); f.hint = "Showing 1 to 1 of 1 items";
    f.rows[0].parts[".mchap-row__ch"] = element("Unknown"); assert.match(f.read().error, /number or ID/);
});
test("explicit zero count is distinct from missing rows", () => {
    const f = fixture(); f.rows = []; assert.equal(f.read().status, "waiting");
    f.hint = "Showing 0 to 0 of 0 items"; assert.equal(f.read().status, "ready");
    assert.equal(f.read().total, 0);
});

// Exercise the actual asynchronous pagination driver with trusted native-input
// events and delayed rendering. No module-discovery helper is supplied.
function walkFixture(pages, options = {}) {
    const f = {page: options.startPage || 1, busy: 0, taps: [], elapsed: 0,
        sort: options.sort || "Sort by date (desc)", group: options.group || "All groups"};
    const listeners = new Map();
    let pointed;
    const button = (text, action, attrs = {}) => ({...element(text, attrs), disabled: false,
        getBoundingClientRect() { pointed = this; return {top:200,bottom:230,left:100,width:90,height:30}; },
        contains(node) {return node === this;}, action,
    });
    const date = button("Date", () => {f.sort = "Sort by date (desc)"; f.busy = 2;});
    date.getAttribute = () => f.sort;
    const next = button("", () => {f.page++; f.busy = 2;});
    const first = button("", () => {f.page = 1; f.busy = 2;});
    const group = button(f.group, () => {});
    const all = button("All groups", () => {f.group = "All groups"; group.textContent = f.group; f.busy = 2;});
    const section = {
        querySelector(selector) {
            return {".mchap-toolbar": {}, ".mpage__group > button": group,
                'button[aria-label="Next page"]': options.missingNext ? null : next,
                'button[aria-label="First page"]': first}[selector] ?? null;
        },
        querySelectorAll(selector) {
            return {".mchap-toolbar__sort button": [date], '[role="menuitemradio"]':[all], ".npager button": []}[selector] || [];
        },
    };
    const document = {readyState:"complete", documentElement:{clientWidth:400,clientHeight:800},
        querySelector(selector) {return selector === ".mpage__chapters" ? section : null;},
        addEventListener: (type, fn) => listeners.set(type,fn),
        removeEventListener: type => listeners.delete(type), elementFromPoint: () => pointed,
    };
    const context = vm.createContext({document, window:{}, innerHeight:800,innerWidth:400,
        Date:{now:()=>f.elapsed}, getComputedStyle:()=>({}),
        setTimeout(fn, delay=0) {return setTimeout(() => {f.elapsed += delay; fn();}, delay === 2000 ? 100 : 0);}, clearTimeout,
    });
    const run = vm.runInContext(`(${asset("chapter_list.js")})`,context);
    f.result = new Promise(resolve => run(() => {
        if(f.busy-- > 0) return {status:"waiting"};
        return pages[f.page-1] || {status:"error",error:"Missing page"};
    }, options.known || [], "/title/abc-", options.maxPages || 100, () => {
        f.taps.push(pointed === next ? "next" : pointed === first ? "first" : pointed.textContent);
        const target = pointed; target.action(); listeners.get("click")?.({isTrusted:true,target});
    }, payload => resolve(JSON.parse(payload))));
    return f;
}
const page = (n, ids, total=5, from=(n-1)*2+1) => ({status:"ready",page:n,from,to:from+ids.length-1,total,
    chapters:ids.map(id=>({id,number:id}))});
test("fresh series walks all pages including the final short page", async () => {
    const f = walkFixture([page(1,[5,4]),page(2,[3,2]),page(3,[1])]);
    const result = await f.result; assert.equal(result.complete,true);
    assert.deepEqual(result.chapters.map(c=>c.id),[5,4,3,2,1]); assert.deepEqual(f.taps,["next","next"]);
    assert.ok(f.elapsed >= 6000, "pagination is paced even without request interception");
});
test("new uploads are collected before the first known chapter", async () => {
    const f = walkFixture([page(1,[110,109]),page(2,[108,100]),page(3,[99])],{known:[100,99]});
    const result = await f.result; assert.equal(result.complete,true);
    assert.deepEqual(result.chapters.map(c=>c.id),[110,109,108,100]); assert.deepEqual(f.taps,["next"]);
});
test("resets group, sort and persisted page before reading", async () => {
    const f = walkFixture([page(1,[2,1],2), page(2,[0],2)],{startPage:2,sort:"Sort by chapter (desc)",group:"Asura Scans"});
    assert.equal((await f.result).complete,true); assert.deepEqual(f.taps,["Asura Scans","All groups","Date","first"]);
});
test("changed counts, overlapping pages and skipped pages fail rather than returning success", async () => {
    for(const bad of [page(2,[3,2],6),page(2,[4,2]),page(2,[3,2],5,4)]) {
        const result = await walkFixture([page(1,[5,4]),bad]).result;
        assert.equal(result.complete,false); assert.ok(result.error);
    }
});
test("missing next control, page limit and parser errors remain visible", async () => {
    assert.match((await walkFixture([page(1,[5,4])],{missingNext:true}).result).error,/control is unavailable/);
    assert.match((await walkFixture([page(1,[5,4])],{maxPages:1}).result).error,/exceeded/);
    assert.match((await walkFixture([{status:"error",error:"Wrong series"}]).result).error,/Wrong series/);
});
