import { extractHeuristicInput, heuristicScore } from "./heuristic.js";
import { triageScore } from "./triage.js";
export async function classify(input) {
    const heuristicInput = extractHeuristicInput(input.messages);
    const heur = heuristicScore(heuristicInput);
    const floor = input.confidenceFloor ?? 0.7;
    if (heur.confidence >= floor)
        return heur;
    if (input.goal === "quality")
        return heur;
    if (!input.triageEnabled || !input.triageModel)
        return heur;
    if (heuristicInput.prompt.length < 20)
        return heur;
    return triageScore({
        prompt: heuristicInput.prompt,
        triageModel: input.triageModel,
        auth: input.auth,
    });
}
export { heuristicScore, extractHeuristicInput };
//# sourceMappingURL=index.js.map