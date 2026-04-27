import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { handoverDir, handoverIndexPath } from "./generator.js";

export interface HandoverIndexEntry {
  ts: string;
  sessionID: string;
  path: string;
  goalOneliner: string;
  ctxAtSave: number;
  ctxWindow: number;
  stickyFloor: string | null;
  goal: string;
  emergency: boolean;
}

export async function listHandovers(limit = 50): Promise<HandoverIndexEntry[]> {
  try {
    const raw = await readFile(handoverIndexPath(), "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const entries: HandoverIndexEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as HandoverIndexEntry);
      } catch {
        // skip corrupted line
      }
    }
    entries.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return entries.slice(0, limit);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return scanFallback(limit);
    throw err;
  }
}

async function scanFallback(limit: number): Promise<HandoverIndexEntry[]> {
  try {
    const files = await readdir(handoverDir());
    const entries: HandoverIndexEntry[] = [];
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const path = join(handoverDir(), file);
      const content = await readFile(path, "utf8").catch(() => "");
      const goal = matchSection(content, "## Goal") ?? "(unknown)";
      const stamp = file.split("-").slice(0, 6).join("-");
      const sessionID = file.replace(/^.*?-([\w-]+)\.md$/, "$1");
      entries.push({
        ts: stamp,
        sessionID,
        path,
        goalOneliner: goal.slice(0, 140),
        ctxAtSave: 0,
        ctxWindow: 0,
        stickyFloor: null,
        goal: "(scanned)",
        emergency: false,
      });
    }
    entries.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return entries.slice(0, limit);
  } catch {
    return [];
  }
}

function matchSection(content: string, heading: string): string | null {
  const idx = content.indexOf(heading);
  if (idx < 0) return null;
  const rest = content.slice(idx + heading.length);
  const lines = rest.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[0] ?? null;
}

export async function readHandoverDoc(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function getLastHandover(): Promise<HandoverIndexEntry | null> {
  const list = await listHandovers(1);
  return list[0] ?? null;
}
