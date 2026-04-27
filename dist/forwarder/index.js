import { findModel, modelsForTier } from "../registry/index.js";
import { forwardOpenAICompat } from "./openai.js";
import { forwardAnthropic } from "./anthropic.js";
import { ForwardError, isRetriableStatus } from "./types.js";
import { logger } from "../util/log.js";
import { tierLadder } from "../policy/index.js";
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
    let escalated = false;
    for (let i = 0; i < tierOrder.length; i++) {
        const tier = tierOrder[i];
        if (!tier)
            continue;
        const candidates = candidatePool(input, tier, tried);
        for (const candidate of candidates) {
            const id = `${candidate.provider}/${candidate.modelID}`;
            tried.add(id);
            try {
                const fwd = FORWARDERS[candidate.apiShape];
                const result = await fwd({
                    request: input.request,
                    model: candidate,
                    auth: input.auth,
                    signal: input.signal,
                });
                return { ...result, attempts: [...attempts, { provider: candidate.provider, modelID: candidate.modelID, status: result.status }], escalated };
            }
            catch (err) {
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
function candidatePool(input, tier, tried) {
    const primary = findModel(input.registry, `${input.decision.provider}/${input.decision.modelID}`);
    const tierMembers = modelsForTier(input.registry, tier);
    const ordered = [];
    if (primary && primary.tier === tier && !tried.has(`${primary.provider}/${primary.modelID}`)) {
        ordered.push(primary);
    }
    for (const m of tierMembers) {
        const id = `${m.provider}/${m.modelID}`;
        if (tried.has(id))
            continue;
        if (primary && id === `${primary.provider}/${primary.modelID}`)
            continue;
        ordered.push(m);
    }
    return ordered;
}
//# sourceMappingURL=index.js.map