import type { ChatMessage, ClassifierResult, Complexity } from "../types.js";

const HIGH_KEYWORDS = [
  "architecture",
  "refactor",
  "debug",
  "optimize",
  "concurrency",
  "race condition",
  "security",
  "vulnerability",
  "async",
  "database schema",
  "migration",
  "performance",
  "deadlock",
  "memory leak",
  "design pattern",
  "system design",
  "distributed",
  "scalability",
  "throughput",
  "complexity analysis",
  "algorithm",
  "rewrite",
];

const LOW_KEYWORDS = [
  "typo",
  "rename",
  "format",
  "indent",
  "comment",
  "spelling",
  "wording",
  "quick question",
  "what does",
  "what is the",
  "shorthand for",
  "command for",
];

const HIGH_CHAR = 3000;
const MEDIUM_CHAR = 500;
const LONG_CTX_CHAR = 50_000;

export interface HeuristicInput {
  prompt: string;
  contextChars: number;
  attachedFiles: number;
  codeBlockCount: number;
}

export function heuristicScore(input: HeuristicInput): ClassifierResult {
  const { prompt, contextChars, attachedFiles, codeBlockCount } = input;
  const promptLen = prompt.length;
  const lower = prompt.toLowerCase();

  if (contextChars > LONG_CTX_CHAR) {
    return { tier: "high", confidence: 0.95, reason: "very large context" };
  }
  if (attachedFiles > 3) {
    return { tier: "high", confidence: 0.9, reason: `${attachedFiles} files attached` };
  }
  if (promptLen > HIGH_CHAR) {
    return { tier: "high", confidence: 0.85, reason: "very long prompt" };
  }

  const highHits = HIGH_KEYWORDS.filter((k) => lower.includes(k));
  const lowHits = LOW_KEYWORDS.filter((k) => lower.includes(k));

  if (highHits.length >= 2) {
    return { tier: "high", confidence: 0.85, reason: `keywords: ${highHits.slice(0, 2).join(", ")}` };
  }
  if (highHits.length === 1) {
    if (promptLen > 300) return { tier: "high", confidence: 0.7, reason: `keyword "${highHits[0]}"` };
    return { tier: "medium", confidence: 0.6, reason: `keyword "${highHits[0]}" (short)` };
  }

  if (lowHits.length >= 1 && promptLen < 200) {
    return { tier: "low", confidence: 0.85, reason: `low keyword "${lowHits[0]}"` };
  }

  if (codeBlockCount >= 2 && promptLen > 800) {
    return { tier: "high", confidence: 0.7, reason: "multiple code blocks + long prompt" };
  }
  if (codeBlockCount >= 1 && promptLen > 400) {
    return { tier: "medium", confidence: 0.65, reason: "code block + medium prompt" };
  }

  if (promptLen < 80) return { tier: "low", confidence: 0.8, reason: "very short prompt" };
  if (promptLen < 200) return { tier: "low", confidence: 0.6, reason: "short prompt" };
  if (promptLen < MEDIUM_CHAR) return { tier: "medium", confidence: 0.55, reason: "medium prompt" };
  return { tier: "medium", confidence: 0.5, reason: "default medium" };
}

export function extractHeuristicInput(messages: ChatMessage[]): HeuristicInput {
  const last = lastUserMessage(messages);
  const prompt = extractText(last?.content);
  const contextChars = messages.reduce((acc, m) => acc + extractText(m.content).length, 0) - prompt.length;
  const attachedFiles = countAttachedFiles(prompt);
  const codeBlockCount = countCodeBlocks(prompt);
  return { prompt, contextChars: Math.max(0, contextChars), attachedFiles, codeBlockCount };
}

export function lastUserMessage(messages: ChatMessage[]): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user") return m;
  }
  return null;
}

export function extractText(content: ChatMessage["content"] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content.map((p) => p.text ?? "").join("\n");
}

function countAttachedFiles(prompt: string): number {
  const re = /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|\/|\\)?[\w.\-\\/]+\.(?:ts|tsx|js|jsx|py|md|json|go|rs|java|cpp|c|h|hpp|sql|yaml|yml|toml|sh|html|css|scss|kt|swift|dart)\b/gi;
  const matches = prompt.match(re);
  return matches?.length ?? 0;
}

function countCodeBlocks(prompt: string): number {
  const m = prompt.match(/```/g);
  return m ? Math.floor(m.length / 2) : 0;
}

export function tierToOrder(t: Complexity): number {
  return t === "low" ? 0 : t === "medium" ? 1 : 2;
}
