// The site's own API client, from the chunks next to the running entry. Every build re-mangles
// names, so members are resolved by source shape; the selector receives the exported members
// found so far, each with the object holding it, and returns what it needs.
(select) => async () => {
    const FIND_TIMEOUT_MS = 10000;
    const modules = new Map();
    let diagnostic;
    const isGet = (value) => typeof value === "function" &&
        String(value).includes(".get(") &&
        String(value).endsWith(".data");
    const scriptUrl = (value) => {
        try {
            const url = new URL(value, document.baseURI);
            return /^https?:$/.test(url.protocol) && /\/assets\/.*\.js$/.test(url.pathname) ? url.href : null;
        } catch {
            return null;
        }
    };
    const find = () => {
        const resources = performance.getEntriesByType("resource")
            .map((entry) => scriptUrl(entry.name)).filter(Boolean);
        // Resource Timing has a finite buffer; scripts and module preloads remain in the document.
        const elements = [...document.querySelectorAll("script[src], link[rel~='modulepreload'][href]")]
            .map((element) => scriptUrl(element.src || element.href)).filter(Boolean);
        const scripts = [...new Set([...resources, ...elements])];
        const entry = scripts.find((url) => /\/main-[^/]+\.js$/.test(new URL(url).pathname));
        diagnostic = { resources: resources.length, elements: elements.length, entry: !!entry,
            loaded: 0, failed: 0, pending: 0, functions: 0, root: 0, get: 0, call: 0, data: 0 };
        if (!entry) return null;
        const directory = new URL(".", entry).href;
        const members = [];
        for (const url of scripts.filter((url) => url.startsWith(directory))) {
            if (!modules.has(url)) {
                const record = { status: "pending" };
                modules.set(url, record);
                // A failed or stalled chunk must not prevent inspection of the remaining chunks.
                import(url).then((namespace) => {
                    record.namespace = namespace;
                    record.status = "loaded";
                }, () => {
                    record.status = "failed";
                });
            }
            const record = modules.get(url);
            diagnostic[record.status]++;
            if (record.status !== "loaded") continue;
            for (const [, exported] of Object.entries(record.namespace)) {
                if (typeof exported === "function") diagnostic.root++;
                if (exported && typeof exported === "object") {
                    for (const [key, member] of Object.entries(exported)) {
                        members.push({ owner: exported, key, value: member });
                        if (member && typeof member === "object") {
                            for (const [nestedKey, nested] of Object.entries(member)) {
                                members.push({ owner: member, key: nestedKey, value: nested });
                            }
                        }
                    }
                }
            }
        }
        for (const { value } of members) {
            if (typeof value !== "function") continue;
            diagnostic.functions++;
            const source = String(value);
            if (source.includes(".get(")) diagnostic.call++;
            if (source.endsWith(".data")) diagnostic.data++;
            if (isGet(value)) diagnostic.get++;
        }
        return select(members, isGet);
    };
    const failure = () => {
        const d = diagnostic;
        const scripts = `res=${d.resources} dom=${d.elements}`;
        if (!d.entry) return `Comix API v56: no main script (${scripts})`;
        const imports = `load=${d.loaded} fail=${d.failed} wait=${d.pending}`;
        if (!d.loaded) return `Comix API v56: modules unavailable (${scripts} ${imports})`;
        const stage = d.get ? "selector missing" : "GET helper missing";
        return `Comix API v56: ${stage} (${scripts} ${imports} fn=${d.functions} root=${d.root} get=${d.get} call=${d.call} data=${d.data})`;
    };
    // The site's chunks keep loading after the page's load event
    const deadline = Date.now() + FIND_TIMEOUT_MS;
    for (;;) {
        const api = find();
        if (api) return api;
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(failure());
        await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
    }
}
