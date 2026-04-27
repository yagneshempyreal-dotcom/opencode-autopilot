import type { SessionState, Tier } from "../types.js";

const sessions = new Map<string, SessionState>();

export function getSession(sessionID: string): SessionState {
  let s = sessions.get(sessionID);
  if (!s) {
    s = {
      sessionID,
      stickyFloor: null,
      tokensIn: 0,
      tokensOut: 0,
      promptCount: 0,
      archived: false,
    };
    sessions.set(sessionID, s);
  }
  return s;
}

export function setStickyFloor(sessionID: string, tier: Tier): void {
  const s = getSession(sessionID);
  s.stickyFloor = tier;
}

export function resetStickyFloor(sessionID: string): void {
  const s = getSession(sessionID);
  s.stickyFloor = null;
}

export function archiveSession(sessionID: string): void {
  const s = getSession(sessionID);
  s.archived = true;
}

export function recordUsage(sessionID: string, tokensIn: number, tokensOut: number, modelID: string): void {
  const s = getSession(sessionID);
  s.tokensIn += tokensIn;
  s.tokensOut += tokensOut;
  s.promptCount += 1;
  s.lastModel = modelID;
}

export function snapshotSessions(): SessionState[] {
  return Array.from(sessions.values()).map((s) => ({ ...s }));
}

export function clearAllSessions(): void {
  sessions.clear();
}
