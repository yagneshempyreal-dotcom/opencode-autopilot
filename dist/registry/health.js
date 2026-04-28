import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { logger } from "../util/log.js";
// Re-probe a "down" model after this much time elapses (gives it a chance to recover).
export const DOWN_RETRY_MS = 5 * 60 * 1000;
// Quota / billing failures are unlikely to clear fast — back off much longer.
export const QUOTA_DOWN_RETRY_MS = 60 * 60 * 1000;
// Don't re-verify a fresh OK record this often.
export const OK_TTL_MS = 30 * 60 * 1000;
const QUOTA_REASON_RE = /(insufficient[_ ]balance|exceeded.*quota|payment[_ ]required|billing|out of credits|rate[_ ]limit|429|402)/i;
export function healthPath() {
    if (process.env.OPENCODE_AUTOPILOT_HEALTH_PATH)
        return process.env.OPENCODE_AUTOPILOT_HEALTH_PATH;
    const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
    return join(stateHome, "opencode", "openauto-health.json");
}
export function emptyStore() {
    return { records: {} };
}
export async function loadHealth(path = healthPath()) {
    try {
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw);
        return { records: parsed.records ?? {} };
    }
    catch (err) {
        const e = err;
        if (e.code === "ENOENT")
            return emptyStore();
        logger.warn("health.json corrupted — starting fresh", { err: err.message });
        return emptyStore();
    }
}
export async function saveHealth(store, path = healthPath()) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
    await rename(tmp, path);
}
export function key(provider, modelID) {
    return `${provider}/${modelID}`;
}
export function markOk(store, k, latencyMs) {
    const now = Date.now();
    store.records[k] = {
        status: "ok",
        lastChecked: now,
        lastOk: now,
        consecutiveFails: 0,
        latencyMs,
    };
}
export function markDown(store, k, reason) {
    const prev = store.records[k];
    const now = Date.now();
    store.records[k] = {
        status: "down",
        lastChecked: now,
        lastOk: prev?.lastOk,
        consecutiveFails: (prev?.consecutiveFails ?? 0) + 1,
        lastError: reason.slice(0, 200),
        // If the failure looks like a quota/billing problem, mark it as such
        // so isHealthy() applies a longer back-off before re-trying.
        quotaError: QUOTA_REASON_RE.test(reason) || undefined,
    };
}
export function isHealthy(store, k, now = Date.now()) {
    const rec = store.records[k];
    if (!rec)
        return true; // unknown → optimistic, will get probed on first use
    if (rec.status === "ok")
        return true;
    if (rec.status !== "down")
        return false;
    // Quota/billing errors clear slowly; transient errors get a faster retry.
    const retryAfter = rec.quotaError ? QUOTA_DOWN_RETRY_MS : DOWN_RETRY_MS;
    return now - rec.lastChecked > retryAfter;
}
export function knownDown(store) {
    return Object.entries(store.records)
        .filter(([, r]) => r.status === "down")
        .map(([k]) => k);
}
// Sends a 1-token "ping" to a model via the same forwarder used for live
// requests. Returns ok=true on any 2xx response. 5s timeout per probe.
export async function probeModel(model, auth, timeoutMs = 8000) {
    const { dispatch } = await import("../forwarder/index.js");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const t0 = Date.now();
    try {
        const result = await dispatch({
            decision: {
                modelID: model.modelID,
                provider: model.provider,
                tier: model.tier,
                reason: "health probe",
                escalated: false,
                override: true, // allowEscalation=false implied below
            },
            request: {
                model: `${model.provider}/${model.modelID}`,
                messages: [{ role: "user", content: "ping" }],
                max_tokens: 1,
                stream: false,
            },
            registry: { models: [model], byID: new Map([[`${model.provider}/${model.modelID}`, model]]), flagged: [] },
            auth,
            signal: ctrl.signal,
            allowEscalation: false,
            // Skip health filtering inside probe to avoid recursion.
            health: emptyStore(),
        });
        // Drain the body so the underlying connection can close.
        if (result.body) {
            try {
                await result.body.cancel?.();
            }
            catch { /* ignore */ }
        }
        return { ok: result.status >= 200 && result.status < 300, latencyMs: Date.now() - t0, status: result.status };
    }
    catch (err) {
        const e = err;
        return { ok: false, latencyMs: Date.now() - t0, status: e.status ?? 0, error: e.message };
    }
    finally {
        clearTimeout(timer);
    }
}
// Probes every model in the registry (with concurrency cap) and writes the
// resulting health snapshot back to disk.
export async function verifyAll(models, auth, store, opts = {}) {
    const concurrency = Math.max(1, opts.concurrency ?? 4);
    const start = Date.now();
    const ok = [];
    const down = [];
    let cursor = 0;
    async function worker() {
        while (cursor < models.length) {
            const idx = cursor++;
            const m = models[idx];
            if (!m)
                return;
            const id = key(m.provider, m.modelID);
            const r = await probeModel(m, auth, opts.timeoutMs);
            if (r.ok) {
                markOk(store, id, r.latencyMs);
                ok.push(id);
            }
            else {
                markDown(store, id, r.error ?? `status ${r.status}`);
                down.push({ id, status: r.status, error: r.error });
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, models.length) }, () => worker()));
    return { total: models.length, ok, down, durationMs: Date.now() - start };
}
//# sourceMappingURL=health.js.map