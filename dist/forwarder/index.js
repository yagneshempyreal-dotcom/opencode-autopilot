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
    const tierOrder = input.allowEscalation ? tierLadder(startTier) : [startTier];
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
            try {
                const fwd = FORWARDERS[candidate.apiShape];
                const result = await fwd({
                    request: input.request,
                    model: candidate,
                    auth: input.auth,
                    signal: input.signal,
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
        }
        if (i < tierOrder.length - 1)
            escalated = true;
    }
    throw new ForwardError(503, `all candidates failed: ${JSON.stringify(attempts)}`, false);
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