const OVERRIDE_RE = /(?:^|\s)@([\w./:-]+)\b/;
// opencode TUI intercepts "/" as a slash-command palette, so prefer "!"
// for in-chat directives. Accept either explicit prefix; never bare words
// (would false-trigger on normal text like "upgrade the lib" or "router config").
const ROUTER_PREFIX = "(?:^|\\s)[!/]router";
const AUTO_PREFIX = "(?:^|\\s)[!/]auto";
const UPGRADE_PREFIX = "(?:^|\\s)[!/]upgrade";
const SLASH_UPGRADE_RE = new RegExp(`${UPGRADE_PREFIX}\\b`, "i");
const SLASH_RESET_RE = new RegExp(`${ROUTER_PREFIX}\\s+reset\\b`, "i");
const SLASH_AUTO_OFF_RE = new RegExp(`${AUTO_PREFIX}\\s+off\\b`, "i");
const SLASH_AUTO_ON_RE = new RegExp(`${AUTO_PREFIX}\\s+on\\b`, "i");
const SLASH_RESUME_RE = new RegExp(`${ROUTER_PREFIX}\\s+resume\\b`, "i");
const SLASH_GOAL_RE = new RegExp(`${ROUTER_PREFIX}\\s+goal\\s+(cost|balance|quality)\\b`, "i");
const SLASH_STATUS_RE = new RegExp(`${ROUTER_PREFIX}\\s+status\\b`, "i");
const SLASH_MODELS_RE = new RegExp(`${ROUTER_PREFIX}\\s+models\\b`, "i");
const UPGRADE_PHRASES = [
    /\bthis is wrong\b/i,
    /\btry again\b/i,
    /\bnot good enough\b/i,
    /\bgive me a better\b/i,
    /\bnot working\b/i,
    /\buse a (better|smarter) model\b/i,
];
export function parseRequest(raw, sessionIDHeader) {
    const messages = [...raw.messages];
    const lastUser = lastUserIndex(messages);
    let override = null;
    const signals = {
        upgradeRequested: false,
        reset: false,
        autoOff: false,
        autoOn: false,
        resumeRequested: false,
        goalSwitch: null,
        statusRequested: false,
        modelsRequested: false,
    };
    if (lastUser >= 0) {
        const msg = messages[lastUser];
        if (msg) {
            const txt = extractText(msg.content);
            const overrideMatch = OVERRIDE_RE.exec(txt);
            if (overrideMatch && overrideMatch[1]) {
                override = { modelRef: overrideMatch[1] };
            }
            if (SLASH_UPGRADE_RE.test(txt))
                signals.upgradeRequested = true;
            if (SLASH_RESET_RE.test(txt))
                signals.reset = true;
            if (SLASH_AUTO_OFF_RE.test(txt))
                signals.autoOff = true;
            if (SLASH_AUTO_ON_RE.test(txt))
                signals.autoOn = true;
            if (SLASH_RESUME_RE.test(txt))
                signals.resumeRequested = true;
            const goalMatch = SLASH_GOAL_RE.exec(txt);
            if (goalMatch && goalMatch[1]) {
                signals.goalSwitch = goalMatch[1].toLowerCase();
            }
            if (SLASH_STATUS_RE.test(txt))
                signals.statusRequested = true;
            if (SLASH_MODELS_RE.test(txt))
                signals.modelsRequested = true;
            if (!signals.upgradeRequested) {
                for (const re of UPGRADE_PHRASES)
                    if (re.test(txt)) {
                        signals.upgradeRequested = true;
                        break;
                    }
            }
        }
    }
    const sessionID = sessionIDHeader ?? raw["x-session-id"] ?? `session-${process.pid}`;
    return { request: { ...raw, messages }, override, signals, sessionID };
}
export function lastUserIndex(messages) {
    for (let i = messages.length - 1; i >= 0; i--)
        if (messages[i]?.role === "user")
            return i;
    return -1;
}
export function extractText(content) {
    if (!content)
        return "";
    if (typeof content === "string")
        return content;
    return content.map((p) => p.text ?? "").join("\n");
}
//# sourceMappingURL=parse.js.map