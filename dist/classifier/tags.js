import { extractText, lastUserMessage } from "./heuristic.js";
// Heuristic task-tag extractor. Reads the last user prompt and emits a small
// set of capability tags that should bias model selection. Conservative on
// purpose — false positives waste a tier upgrade, false negatives just lose
// the bonus.
const RULES = [
    { tag: "code", re: /\b(?:function|class|const|let|var|import|export|async|await|=>|return|null|undefined|TypeError|stack ?trace|compile|build|tsc|eslint|webpack|vite|bun|npm|yarn|pnpm|git\b|repo|branch|commit|pr|merge|conflict|refactor|bug|crash|exception|segfault|null pointer|API|endpoint|REST|GraphQL|SQL|query|schema|migration|test|unit test|integration|mock|stub|TDD|debug|stack overflow|regex)\b/i },
    { tag: "math", re: /\b(?:integral|derivative|matrix|eigen|theorem|proof|lemma|equation|solve for|polynomial|combinatori|probability|permutation|factorial|prime|topology|calculus|algebra|differential|big-?o|complexity analysis|asymptotic)\b/i },
    { tag: "reasoning", re: /\b(?:why does|why is|why would|step ?by ?step|reason through|think (?:hard|carefully|step)|chain of thought|design pattern|architect|trade-?off|root cause|deeply|exhaustive|systematic|rigorous|formal proof|invariant|race condition|deadlock|distributed)\b/i },
    { tag: "vision", re: /\b(?:image|screenshot|photo|picture|attached.*png|jpeg|jpg|gif|figma|design|UI|layout|figure|diagram|chart|graph)\b/i },
    { tag: "fast", re: /\b(?:quick(?:ly)?|short|tl;?dr|one-?liner|concise|brief|fast|simple|just give me)\b/i },
    { tag: "long-ctx", re: null }, // computed from length below
];
const LONG_CTX_CHARS = 30_000;
export function extractTaskTags(messages) {
    const last = lastUserMessage(messages);
    const prompt = extractText(last?.content);
    const total = messages.reduce((acc, m) => acc + extractText(m.content).length, 0);
    const tags = [];
    for (const r of RULES) {
        if (!r.re)
            continue;
        if (r.re.test(prompt))
            tags.push(r.tag);
    }
    if (total > LONG_CTX_CHARS)
        tags.push("long-ctx");
    return Array.from(new Set(tags));
}
//# sourceMappingURL=tags.js.map