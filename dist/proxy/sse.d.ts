export declare function sseLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string, void, unknown>;
export interface OpenAIDelta {
    choices?: Array<{
        delta?: {
            content?: string;
        };
        finish_reason?: string | null;
    }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
}
export declare function extractDeltaText(line: string): string;
export declare function extractUsage(line: string): {
    in: number;
    out: number;
} | null;
//# sourceMappingURL=sse.d.ts.map