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

export function resetSessionRouting(sessionID: string): void {
  const s = getSession(sessionID);
  s.stickyFloor = null;
  s.premiumExhausted = false;
  s.freeModeActive = false;
}

export function setPremiumExhausted(sessionID: string, exhausted: boolean): void {
  getSession(sessionID).premiumExhausted = exhausted;
}

export function isPremiumExhausted(sessionID: string): boolean {
  return getSession(sessionID).premiumExhausted === true;
}

export function setFreeModeActive(sessionID: string, active: boolean): void {
  const s = getSession(sessionID);
  s.freeModeActive = active;
  if (active) s.premiumExhausted = false;
}

export function isFreeModeActive(sessionID: string): boolean {
  return getSession(sessionID).freeModeActive === true;
}

export function isPremiumBlocked(sessionID: string): boolean {
  const s = getSession(sessionID);
  return s.premiumExhausted === true && s.freeModeActive !== true;
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
