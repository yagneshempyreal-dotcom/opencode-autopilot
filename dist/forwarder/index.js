import { findModel, modelsForTier } from "../registry/index.js";
import { forwardOpenAICompat } from "./openai.js";
import { forwardAnthropic } from "./anthropic.js";
import { ForwardError, isRetriableStatus } from "./types.js";
import { logger } from "../util/log.js";
import { tierLadder } from "../policy/index.js";
import { isHealthy, key as healthKey, markOk, markDown, emptyStore } from "../registry/health.js";
const FORWARDERS = {
    openai: forwardOpenAICompat,
    openrouter: forwardOpenAICompat,
    opencode: forwardOpenAICompat,
    anthropic: forwardAnthropic,
};
export async function dispatch(input) {
    const attempts = [];
    const tried = new Set();
    const startTier = input.decision.tier;
    // Bidirectional fallback: try the target tier, then any higher tiers
    // (escalation), then any lower tiers (downgrade). The router should
    // always reach SOME working model rather than 503 just because the
    // user has no quota left on the paid models.
    const tierOrder = input.allowEscalation
        ? dedupeTiers([...tierLadder(startTier), ...lowerTiers(startTier)])
        : [startTier];
    const health = input.health ?? emptyStore();
    let escalated = false;
    for (let i = 0; i < tierOrder.length; i++) {
        const tier = tierOrder[i];
        if (!tier)
            continue;
        const candidates = candidatePool(input, tier, tried, health);
        for (const candidate of candidates) {
            const id = `${candidate.provider}/${candidate.modelID}`;
            tried.add(id);
            const t0 = Date.now();
            // Per-attempt timeout. If a model hangs, abort and try the next
            // candidate rather than freezing the whole dispatch.
            const timeoutMs = input.perAttemptTimeoutMs ?? 60_000;
            const ctrl = new AbortController();
            const upstream = input.signal;
            const onUpstreamAbort = () => ctrl.abort();
            if (upstream)
                upstream.addEventListener("abort", onUpstreamAbort, { once: true });
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            try {
                const fwd = FORWARDERS[candidate.apiShape];
                const result = await fwd({
                    request: input.request,
                    model: candidate,
                    auth: input.auth,
                    signal: ctrl.signal,
                });
                markOk(health, healthKey(candidate.provider, candidate.modelID), Date.now() - t0);
                return { ...result, attempts: [...attempts, { provider: candidate.provider, modelID: candidate.modelID, status: result.status }], escalated };
            }
            catch (err) {
                const reason = err instanceof ForwardError ? err.detail ?? `status ${err.status}` : err.message;
                markDown(health, healthKey(candidate.provider, candidate.modelID), reason ?? "error");
                if (err instanceof ForwardError) {
                    attempts.push({ provider: candidate.provider, modelID: candidate.modelID, status: err.status, reason: err.detail });
                    logger.warn("forward attempt failed", { provider: candidate.provider, model: candidate.modelID, status: err.status });
                    if (!err.retriable && !isRetriableStatus(err.status))
                        continue;
                }
                else {
                    attempts.push({ provider: candidate.provider, modelID: candidate.modelID, status: 0, reason: err.message });
                    logger.warn("forward exception", { provider: candidate.provider, model: candidate.modelID, err: err.message });
                }
            }
            finally {
                clearTimeout(timer);
                if (upstream)
                    upstream.removeEventListener("abort", onUpstreamAbort);
            }
        }
        if (i < tierOrder.length - 1)
            escalated = true;
    }
    throw new ForwardError(503, `all candidates failed: ${JSON.stringify(attempts)}`, false);
}
function lowerTiers(start) {
    const all = ["free", "cheap-paid", "top-paid"];
    const idx = all.indexOf(start);
    if (idx <= 0)
        return [];
    return all.slice(0, idx).reverse(); // closest-lower first
}
function dedupeTiers(arr) {
    const seen = new Set();
    const out = [];
    for (const t of arr) {
        if (seen.has(t))
            continue;
        seen.add(t);
        out.push(t);
    }
    return out;
}
function candidatePool(input, tier, tried, health) {
    const primary = findModel(input.registry, `${input.decision.provider}/${input.decision.modelID}`);
    const tierMembers = modelsForTier(input.registry, tier);
    const ordered = [];
    const isOk = (m) => isHealthy(health, healthKey(m.provider, m.modelID));
    if (primary && primary.tier === tier && !tried.has(`${primary.provider}/${primary.modelID}`) && isOk(primary)) {
        ordered.push(primary);
    }
    for (const m of tierMembers) {
        const id = `${m.provider}/${m.modelID}`;
        if (tried.has(id))
            continue;
        if (primary && id === `${primary.provider}/${primary.modelID}`)
            continue;
        if (!isOk(m))
            continue;
        ordered.push(m);
    }
    // If health filter wiped the pool entirely, fall back to "give them a try"
    // — better to attempt a known-down model than to 503 with nothing tried.
    if (ordered.length === 0) {
        if (primary && primary.tier === tier && !tried.has(`${primary.provider}/${primary.modelID}`))
            ordered.push(primary);
        for (const m of tierMembers) {
            const id = `${m.provider}/${m.modelID}`;
            if (tried.has(id))
                continue;
            if (primary && id === `${primary.provider}/${primary.modelID}`)
                continue;
            ordered.push(m);
        }
    }
    return ordered;
}
//# sourceMappingURL=index.js.map