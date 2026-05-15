import { loadConfig } from "../../config/store.js";
import { flag } from "../args.js";
export async function runChat(args) {
    const stream = !args.includes("--no-stream");
    const session = flag(args, "session") ?? "cli-default";
    const promptParts = args.filter((a) => !a.startsWith("--"));
    const prompt = promptParts.join(" ").trim();
    if (!prompt) {
        console.error('Usage: openauto chat "your prompt" [--session=id] [--no-stream]');
        console.error("Requires `openauto serve` running in another terminal (or background).");
        process.exit(2);
    }
    const cfg = await loadConfig();
    const base = `http://${cfg.proxy.host}:${cfg.proxy.port}/v1`;
    let ok = false;
    try {
        const health = await fetch(`${base.replace(/\/v1$/, "")}/health`, { signal: AbortSignal.timeout(3000) });
        ok = health.ok;
    }
    catch {
        ok = false;
    }
    if (!ok) {
        console.error(`Router not reachable at ${base}`);
        console.error("Start it with: openauto serve");
        process.exit(1);
    }
    const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-session-id": session,
        },
        body: JSON.stringify({
            model: "auto",
            stream,
            messages: [{ role: "user", content: prompt }],
        }),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
        process.exit(1);
    }
    if (!stream || !res.body) {
        const json = await res.json();
        const content = json.choices?.[0]?.message?.content ?? "";
        process.stdout.write(content);
        if (!content.endsWith("\n"))
            process.stdout.write("\n");
        return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.startsWith("data:"))
                continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]")
                continue;
            try {
                const chunk = JSON.parse(payload);
                const delta = chunk.choices?.[0]?.delta?.content;
                if (delta)
                    process.stdout.write(delta);
            }
            catch { /* skip */ }
        }
    }
    process.stdout.write("\n");
}
//# sourceMappingURL=chat.js.map