const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("the production bridge sends current viewport width with both tap and swipe coordinates", () => {
    const source = fs.readFileSync(path.join(__dirname, "../src/eu/kanade/tachiyomi/extension/en/comix/Comix.kt"), "utf8");
    const line = source.split(/\r?\n/).find(line => line.includes("window.$touchName = points =>"));
    assert.ok(line, "production touch bridge missing");
    const sent = [];
    const window = {innerWidth:360, nativeTouch:{postMessage: message => sent.push(message)}};
    vm.runInNewContext(line.replace("$touchName","sendTouch").replace("$touchBridgeName","nativeTouch"), {window});
    window.sendTouch([50,100]);
    window.innerWidth = 720;
    window.sendTouch([50,200,50,50]);
    assert.deepEqual(sent, ["360,50,100", "720,50,200,50,50"]);
});
