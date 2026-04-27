import { mkdir, appendFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { extractText } from "../classifier/heuristic.js";
import { logger } from "../util/log.js";
import { bearerToken, getCredential } from "../config/auth.js";
import { opencodeHandoverDir } from "../util/paths.js";
export function handoverDir() {
    return opencodeHandoverDir();
}
export function handoverIndexPath() {
    return join(handoverDir(), "INDEX.jsonl");
}
export const HANDOVER_DIR = handoverDir();
export const HANDOVER_INDEX = handoverIndexPath();
export async function generateHandover(input) {
    const dir = handoverDir();
    const indexPath = handoverIndexPath();
    await mkdir(dir, { recursive: true });
    const summary = input.emergency
        ? buildEmergencyDoc(input)
        : await buildSummarizedDoc(input);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = join(dir, `${stamp}-${input.session.sessionID}.md`);
    await writeFile(path, summary.markdown, "utf8");
    const indexEntry = {
        ts: new Date().toISOString(),
        sessionID: input.session.sessionID,
        path,
        goalOneliner: summary.goalOneliner,
        ctxAtSave: input.ctxAtSave,
        ctxWindow: input.ctxWindow,
        stickyFloor: input.session.stickyFloor,
        goal: input.goal,
        emergency: input.emergency,
    };
    await mkdir(dirname(indexPath), { recursive: true });
    await appendFile(indexPath, `${JSON.stringify(indexEntry)}\n`, "utf8");
    return { path, goalOneliner: summary.goalOneliner, ctxUtilization: input.ctxAtSave / Math.max(input.ctxWindow, 1) };
}
async function buildSummarizedDoc(input) {
    const baseSections = buildBaseSections(input);
    if (!input.summaryModel) {
        return { markdown: assembleMarkdown(input, baseSections, ""), goalOneliner: baseSections.goalOneliner };
    }
    try {
        const llmSummary = await callSummaryLLM(input);
        return { markdown: assembleMarkdown(input, baseSections, llmSummary), goalOneliner: baseSections.goalOneliner };
    }
    catch (err) {
        logger.warn("summary LLM failed, raw dump", { err: err.message });
        return buildEmergencyDoc(input);
    }
}
function buildEmergencyDoc(input) {
    const base = buildBaseSections(input);
    return { markdown: assembleMarkdown(input, base, ""), goalOneliner: base.goalOneliner };
}
function buildBaseSections(input) {
    const firstUser = input.transcript.find((m) => m.role === "user");
    const oneliner = firstUser ? truncate(extractText(firstUser.content), 140) : "(unknown)";
    const filesTouched = extractFileMentions(input.transcript);
    const recentTranscript = formatRecentTranscript(input.transcript, 10);
    return { goalOneliner: oneliner, filesTouched, recentTranscript };
}
function assembleMarkdown(input, base, llmSummary) {
    const ts = new Date().toISOString();
    const sections = [];
    sections.push(`# Session Handover — ${input.session.sessionID} — ${ts}`);
    sections.push("");
    sections.push("## Goal");
    sections.push(base.goalOneliner);
    sections.push("");
    if (llmSummary.trim()) {
        sections.push(llmSummary.trim());
        sections.push("");
    }
    else {
        sections.push("## Decisions made");
        sections.push("- (no LLM summary available; raw transcript below)");
        sections.push("");
        sections.push("## Files touched");
        if (base.filesTouched.length === 0) {
            sections.push("- (none extracted)");
        }
        else {
            for (const f of base.filesTouched)
                sections.push(`- ${f}`);
        }
        sections.push("");
        sections.push("## Current state");
        sections.push("Resume from the recent transcript below.");
        sections.push("");
        sections.push("## Open todos");
        sections.push("- (extract from recent transcript)");
        sections.push("");
    }
    sections.push("## Recent transcript (last 10 turns, verbatim)");
    sections.push(base.recentTranscript);
    sections.push("");
    sections.push("## Session metadata");
    sections.push(`- Goal: ${input.goal}`);
    sections.push(`- Sticky floor at handover: ${input.session.stickyFloor ?? "none"}`);
    sections.push(`- Tokens in/out (estimated): ${input.session.tokensIn} / ${input.session.tokensOut}`);
    sections.push(`- Prompts in session: ${input.session.promptCount}`);
    sections.push(`- Last model: ${input.session.lastModel ?? "(unknown)"}`);
    sections.push(`- Context utilization at save: ${(input.ctxAtSave / Math.max(input.ctxWindow, 1)).toFixed(2)}`);
    sections.push(`- Emergency mode: ${input.emergency}`);
    return sections.join("\n");
}
function extractFileMentions(transcript) {
    const re = /(?:^|[\s'"`(])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/])?[\w.\-\\/]+\.(?:ts|tsx|js|jsx|py|md|json|go|rs|java|cpp|c|h|hpp|sql|yaml|yml|toml|sh|html|css|scss|kt|swift|dart))/g;
    const found = new Set();
    for (const m of transcript) {
        const text = extractText(m.content);
        let match;
        while ((match = re.exec(text)) !== null) {
            const cand = match[1];
            if (cand)
                found.add(cand);
        }
    }
    return Array.from(found).slice(0, 30);
}
function formatRecentTranscript(transcript, n) {
    const tail = transcript.slice(-n);
    return tail
        .map((m) => {
        const text = truncate(extractText(m.content), 2000);
        return `### ${m.role}\n\n${text}`;
    })
        .join("\n\n");
}
async function callSummaryLLM(input) {
    if (!input.summaryModel)
        return "";
    const cred = getCredential(input.auth, input.summaryModel.provider);
    const token = bearerToken(cred);
    if (!token && input.summaryModel.provider !== "opencode")
        return "";
    const baseURL = input.summaryModel.baseURL;
    if (!baseURL)
        return "";
    const prompt = buildSummaryPrompt(input.transcript);
    const headers = { "content-type": "application/json" };
    if (token)
        headers["authorization"] = `Bearer ${token}`;
    const res = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model: input.summaryModel.modelID,
            messages: [
                { role: "system", content: SUMMARY_SYSTEM },
                { role: "user", content: prompt },
            ],
            temperature: 0.2,
            max_tokens: 2000,
            stream: false,
        }),
    });
    if (!res.ok)
        throw new Error(`summary HTTP ${res.status}`);
    const data = (await res.json());
    return data.choices?.[0]?.message?.content ?? "";
}
const SUMMARY_SYSTEM = `You are summarizing a coding session into a handover document.
Output ONLY markdown sections in this exact order:

## Decisions made
- bullet list of concrete decisions

## Files touched
- path:line — what changed and why

## Current state
One paragraph: what was just finished and what is next.

## Open todos
- bullet list (use [ ] / [x])

## Key context (verbatim quotes that matter)
> short, decisive quote

Be specific. No filler. No preamble. No closing sentence.`;
function buildSummaryPrompt(transcript) {
    const condensed = transcript
        .slice(-40)
        .map((m) => `[${m.role}]\n${truncate(extractText(m.content), 4000)}`)
        .join("\n\n---\n\n");
    return `Summarize this session for handover:\n\n${condensed}`;
}
function truncate(s, n) {
    return s.length <= n ? s : `${s.slice(0, n)}\n…[truncated]`;
}
//# sourceMappingURL=generator.js.map