(discover, mangaId, chapterPath, snapshotIds, resolve, reject) => {
    const requestedLimit = 100;
    const known = new Set(snapshotIds);
    let restore = () => {};
    const chapterMethod = (value) => {
        if (typeof value !== "function") return false;
        const source = String(value);
        return /^(?:async [\w$]+ ?|async ?|[\w$]+ ?)?\([\w$]+,[\w$]+=\{\}\)(?:=>|\{)/.test(source)
            && source.includes(".items.map(") && source.includes(".meta")
            && source.includes("{params:") && !/\.items\.map\([\w$]+=>/.test(source);
    };
    const queries = () => {
        try { return JSON.parse(document.querySelector("script#initial-data")?.textContent || "null")?.queries || null; }
        catch { return null; }
    };
    const validChapter = (chapter) => chapter && Number.isSafeInteger(chapter.id) && chapter.id > 0
        && typeof chapter.number === "number" && Number.isFinite(chapter.number)
        && typeof chapter.url === "string" && chapter.url.includes(chapterPath);
    const findRequestInitializer = (namespace, owner, getOwner) => {
        const exports = Object.values(namespace || {});
        if (!exports.includes(owner) || !exports.includes(getOwner)) throw new Error("Could not find the site's chapter client module");
        const initializers = [...new Set(exports.filter((value) => typeof value === "function"
            && /^function(?:\s+[A-Za-z_$][\w$]*)?\s*\(\s*\)\s*\{\s*[A-Za-z_$][\w$]*\s*=\s*Date\s*\.\s*now\s*\(\s*\)\s*;?\s*\}$/.test(Function.prototype.toString.call(value))))];
        if (initializers.length !== 1) throw new Error("Could not find a unique chapter request initializer in the site's client module");
        return initializers[0];
    };
    const run = async () => {
        if (document.readyState === "loading") {
            await new Promise((ready) => document.addEventListener("DOMContentLoaded", ready, { once: true }));
        }
        if (document.title === "Third-party apps are not supported") throw new Error("Comix blocked this browser session before chapter loading.");
        const findApi = discover((entries, isGet, namespace) => {
            const method = entries.find((entry) => chapterMethod(entry.value));
            const get = entries.find((entry) => isGet(entry.value));
            if (!method || !get) return null;
            const initializeRequest = findRequestInitializer(namespace, method.owner, get.owner);
            const records = [];
            const original = get.owner[get.key];
            const wrapped = async (path, options) => {
                const matching = path === `/manga/${mangaId}/chapters`;
                try {
                    const result = await original.call(get.owner, path, options);
                    if (matching) records.push({ params: options?.params, result });
                    return result;
                } catch (error) {
                    if (matching) records.push({ params: options?.params, error });
                    throw error;
                }
            };
            get.owner[get.key] = wrapped;
            restore = () => { get.owner[get.key] = original; };
            return { method: method.value, owner: method.owner, initializeRequest, records };
        });
        const api = await findApi();
        if (!api) throw new Error("Could not find the site's chapters API");
        const initializeRequest = api.initializeRequest;
        const chapters = [];
        const seen = new Set();
        let total = null;
        let lastPage = null;
        for (let page = 1; page <= 1000; page++) {
            api.records.length = 0;
            let requestError;
            const requestParams = { page, limit: requestedLimit, order: { created_at: "desc" } };
            try {
                // The client reads its activity timestamp when calculating pagination flags.
                // Use the module's setter; do not override flags or clear a flagged session.
                initializeRequest();
                await api.method.call(api.owner, mangaId, requestParams);
            } catch (error) { requestError = error; }
            const record = api.records.find((item) => item.params === requestParams);
            if (!record || record.error) {
                const error = record?.error || requestError;
                const status = error?.response?.status;
                throw new Error(status ? `Comix chapter request failed (HTTP ${status})` : error?.message || `Chapter page ${page} did not return`);
            }
            const { items, meta } = record.result || {};
            if (!Array.isArray(items) || !items.every(validChapter) || !meta
                || ![meta.page, meta.lastPage, meta.total, meta.perPage].every(Number.isSafeInteger)
                || meta.page !== page || meta.lastPage < page || meta.total < 0 || meta.perPage < 1
                || meta.lastPage !== Math.max(1, Math.ceil(meta.total / meta.perPage))) {
                throw new Error(`Comix returned invalid chapter pagination on page ${page}`);
            }
            if (total !== null && (meta.total !== total || meta.lastPage !== lastPage)) {
                throw new Error("The chapter list changed while loading. Refresh to try again.");
            }
            total = meta.total;
            lastPage = meta.lastPage;
            const expectedCount = Math.min(meta.perPage, Math.max(0, total - (page - 1) * meta.perPage));
            if (items.length !== expectedCount) throw new Error(`Comix returned an incomplete chapter page ${page}`);
            for (const chapter of items) {
                if (seen.has(chapter.id)) throw new Error("Comix repeated chapters while loading");
                seen.add(chapter.id);
                chapters.push(chapter);
            }
            const combined = new Set([...known, ...seen]);
            if (known.size && items.some((chapter) => known.has(chapter.id)) && combined.size === total) {
                return { chapters, complete: true, incremental: true, chapterIds: [...combined], total, queries: queries() };
            }
            if (page === lastPage) {
                if (seen.size !== total) throw new Error("The chapter list is incomplete");
                return { chapters, complete: true, incremental: false, chapterIds: [...seen], total, queries: queries() };
            }
        }
        throw new Error("The chapter list exceeds 1000 pages");
    };
    return run().then((result) => { restore(); resolve(JSON.stringify(result)); }, (error) => { restore(); reject(error?.message || String(error)); });
}
