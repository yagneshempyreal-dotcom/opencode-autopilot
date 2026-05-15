import type { SessionState, Tier } from "../types.js";
export declare function getSession(sessionID: string): SessionState;
export declare function setStickyFloor(sessionID: string, tier: Tier): void;
export declare function resetStickyFloor(sessionID: string): void;
export declare function resetSessionRouting(sessionID: string): void;
export declare function setPremiumExhausted(sessionID: string, exhausted: boolean): void;
export declare function isPremiumExhausted(sessionID: string): boolean;
export declare function setFreeModeActive(sessionID: string, active: boolean): void;
export declare function isFreeModeActive(sessionID: string): boolean;
export declare function isPremiumBlocked(sessionID: string): boolean;
export declare function archiveSession(sessionID: string): void;
export declare function recordUsage(sessionID: string, tokensIn: number, tokensOut: number, modelID: string): void;
export declare function snapshotSessions(): SessionState[];
export declare function clearAllSessions(): void;
//# sourceMappingURL=state.d.ts.map