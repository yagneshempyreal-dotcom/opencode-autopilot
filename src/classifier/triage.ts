import type { ClassifierResult, Complexity, ModelEntry, OpenCodeAuth } from "../types.js";
import { bearerToken, getCredential } from "../config/auth.js";
import { logger } from "../util/log.js";

const TRIAGE_TIMEOUT_MS = 8000;

const TRIAGE_PROMPT = `You are a complexity rater. Read the user's request and respond with only a single integer 1-10 inside <score>X</score>. No other text.
1-3 = trivial (typos, simple lookups)
4-6 = standard (code generation, light refactor, single-file fixes)
7-10 = hard (architecture, large refactor, debugging across files, design problems)`;

export interface TriageInput {
  prompt: string;
  triageModel: ModelEntry;
  auth: OpenCodeAuth;
}

export async function triageScore(input: TriageInput): Promise<ClassifierResult> {
  const { prompt, triageModel, auth } = input;
  const cred = getCredential(auth, triageModel.provider);
  const token = bearerToken(cred);
  if (!token && triageModel.provider !== "opencode") {
    return { tier: "medium", confidence: 0.5, reason: "triage skipped (no auth)" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRIAGE_TIMEOUT_MS);
  try {
    const baseURL = triageModel.baseURL ?? "https://openrouter.ai/api/v1";
    const url = `${baseURL.replace(/\/$/, "")}/chat/completions`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers["authorization"] = `Bearer ${token}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: triageModel.modelID,
        messages: [
          { role: "system", content: TRIAGE_PROMPT },
          { role: "user", content: truncate(prompt, 1500) },
        ],
        temperature: 0,
        max_tokens: 10,
        stream: false,
      }),
    });

    if (!res.ok) {
      logger.warn("triage call failed", { status: res.status, model: triageModel.modelID });
      return { tier: "medium", confidence: 0.5, reason: `triage HTTP ${res.status}` };
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    const score = parseScore(content);
    if (score == null) {
      return { tier: "medium", confidence: 0.5, reason: "triage unparseable" };
    }
    return scoreToResult(score);
  } catch (err) {
    logger.warn("triage error", { err: (err as Error).message });
    return { tier: "medium", confidence: 0.5, reason: "triage error" };
  } finally {
    clearTimeout(timeout);
  }
}

function parseScore(text: string): number | null {
  const tagged = text.match(/<score>\s*(\d+)\s*<\/score>/i);
  if (tagged && tagged[1]) {
    const n = parseInt(tagged[1], 10);
    if (Number.isFinite(n)) return clamp(n, 1, 10);
  }
  const m = text.match(/\b(\d+)\b/);
  if (m && m[1]) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) return clamp(n, 1, 10);
  }
  return null;
}

function scoreToResult(score: number): ClassifierResult {
  let tier: Complexity;
  if (score <= 3) tier = "low";
  else if (score <= 6) tier = "medium";
  else tier = "high";
  return { tier, confidence: 0.85, reason: `triage score ${score}` };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}\n…[truncated]`;
}
