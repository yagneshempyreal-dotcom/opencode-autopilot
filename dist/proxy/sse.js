export async function* sseLines(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 1);
                yield line;
            }
        }
        if (buffer.length > 0)
            yield buffer;
    }
    finally {
        reader.releaseLock();
    }
}
export function extractDeltaText(line) {
    if (!line.startsWith("data:"))
        return "";
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]")
        return "";
    try {
        const parsed = JSON.parse(payload);
        return parsed.choices?.[0]?.delta?.content ?? "";
    }
    catch {
        return "";
    }
}
export function extractUsage(line) {
    if (!line.startsWith("data:"))
        return null;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]")
        return null;
    try {
        const parsed = JSON.parse(payload);
        if (parsed.usage) {
            return {
                in: parsed.usage.prompt_tokens ?? 0,
                out: parsed.usage.completion_tokens ?? 0,
            };
        }
        return null;
    }
    catch {
        return null;
    }
}
export function extractFinishReason(line) {
    if (!line.startsWith("data:"))
        return null;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]")
        return null;
    try {
        const parsed = JSON.parse(payload);
        return parsed.choices?.[0]?.finish_reason ?? null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=sse.js.map