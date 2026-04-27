const sessions = new Map();
export function getSession(sessionID) {
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
export function setStickyFloor(sessionID, tier) {
    const s = getSession(sessionID);
    s.stickyFloor = tier;
}
export function resetStickyFloor(sessionID) {
    const s = getSession(sessionID);
    s.stickyFloor = null;
}
export function archiveSession(sessionID) {
    const s = getSession(sessionID);
    s.archived = true;
}
export function recordUsage(sessionID, tokensIn, tokensOut, modelID) {
    const s = getSession(sessionID);
    s.tokensIn += tokensIn;
    s.tokensOut += tokensOut;
    s.promptCount += 1;
    s.lastModel = modelID;
}
export function snapshotSessions() {
    return Array.from(sessions.values()).map((s) => ({ ...s }));
}
export function clearAllSessions() {
    sessions.clear();
}
//# sourceMappingURL=state.js.map