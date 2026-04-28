const OVERRIDE_RE = /(?:^|\s)@([\w./:-]+)\b/;
// opencode TUI intercepts "/" (slash command palette) and "!" (shell run),
// so router commands must use a prefix the TUI passes through to the model.
// Accepted forms (anchored to message start so prose doesn't false-trigger):
//   router goal balance
//   #router goal balance
//   :router goal balance
//   >router goal balance
//   /router goal balance   (legacy; works in hosts that don't eat "/")
// Legacy /upgrade and /auto are kept so existing scripts/docs still work.
const ROUTER_PREFIX = "^\\s*[#:>/]?\\s*router";
const SLASH_RESET_RE = new RegExp(`${ROUTER_PREFIX}\\s+reset\\b`, "i");
const SLASH_RESUME_RE = new RegExp(`${ROUTER_PREFIX}\\s+resume\\b`, "i");
const SLASH_GOAL_RE = new RegExp(`${ROUTER_PREFIX}\\s+goal\\s+(cost|balance|quality)\\b`, "i");
const SLASH_STATUS_RE = new RegExp(`${ROUTER_PREFIX}\\s+status\\b`, "i");
const SLASH_MODELS_RE = new RegExp(`${ROUTER_PREFIX}\\s+models\\b`, "i");
const SLASH_VERIFY_RE = new RegExp(`${ROUTER_PREFIX}\\s+verify\\b`, "i");
const SLASH_HEALTH_RE = new RegExp(`${ROUTER_PREFIX}\\s+health\\b`, "i");
const SLASH_QUIET_RE = new RegExp(`${ROUTER_PREFIX}\\s+quiet\\b`, "i");
const SLASH_VERBOSE_RE = new RegExp(`${ROUTER_PREFIX}\\s+verbose\\b`, "i");
// "router pick all-ok" | "router pick clear" | "router pick a/b, c/d, ..."
const SLASH_PICK_RE = new RegExp(`${ROUTER_PREFIX}\\s+pick\\s+(.+)$`, "i");
// Upgrade / auto kept under the router umbrella too. Legacy "/upgrade" and
// "/auto on|off" still match anywhere in message (whitespace-preceded) since
// "/" is unambiguous; new bare "router upgrade" form is anchored to start.
const SLASH_UPGRADE_RE = /(?:^|\s)\/upgrade\b|^\s*[#:>]?\s*router\s+upgrade\b/i;
const SLASH_AUTO_OFF_RE = /(?:^|\s)\/auto\s+off\b|^\s*[#:>]?\s*router\s+auto\s+off\b/i;
const SLASH_AUTO_ON_RE = /(?:^|\s)\/auto\s+on\b|^\s*[#:>]?\s*router\s+auto\s+on\b/i;
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
        verifyRequested: false,
        pickArg: null,
        healthRequested: false,
        badgeMode: null,
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
            if (SLASH_VERIFY_RE.test(txt))
                signals.verifyRequested = true;
            if (SLASH_HEALTH_RE.test(txt))
                signals.healthRequested = true;
            if (SLASH_QUIET_RE.test(txt))
                signals.badgeMode = "quiet";
            if (SLASH_VERBOSE_RE.test(txt))
                signals.badgeMode = "verbose";
            const pickMatch = SLASH_PICK_RE.exec(txt);
            if (pickMatch && pickMatch[1])
                signals.pickArg = pickMatch[1].trim();
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