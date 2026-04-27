import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export async function ask(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = (await rl.question(`${question}${suffix} `)).trim();
    if (!answer && defaultValue !== undefined) return defaultValue;
    return answer;
  } finally {
    rl.close();
  }
}

export async function askChoice<T extends string>(question: string, choices: T[], defaultIdx = 0): Promise<T> {
  const list = choices.map((c, i) => `  ${i + 1}. ${c}${i === defaultIdx ? "  (default)" : ""}`).join("\n");
  const raw = await ask(`${question}\n${list}\nChoose 1-${choices.length}`, String(defaultIdx + 1));
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1 && n <= choices.length) {
    const choice = choices[n - 1];
    if (choice) return choice;
  }
  for (const c of choices) {
    if (c.toLowerCase() === raw.toLowerCase()) return c;
  }
  const fallback = choices[defaultIdx];
  if (!fallback) throw new Error("no default choice");
  return fallback;
}

export async function askYesNo(question: string, defaultYes = true): Promise<boolean> {
  const raw = (await ask(`${question} (y/n)`, defaultYes ? "y" : "n")).toLowerCase();
  return raw.startsWith("y");
}
