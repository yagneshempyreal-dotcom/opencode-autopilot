const CHARS_PER_TOKEN = 3.8;
export function estimateStringTokens(s) {
    if (!s)
        return 0;
    return Math.ceil(s.length / CHARS_PER_TOKEN);
}
export function estimateMessageTokens(msg) {
    let total = 4;
    if (typeof msg.content === "string") {
        total += estimateStringTokens(msg.content);
    }
    else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
            if (typeof part.text === "string")
                total += estimateStringTokens(part.text);
        }
    }
    return total;
}
export function estimateRequestTokens(messages) {
    let total = 2;
    for (const m of messages)
        total += estimateMessageTokens(m);
    return total;
}
//# sourceMappingURL=tokens.js.map