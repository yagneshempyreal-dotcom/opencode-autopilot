export type LogEntry = {
    ts: string;
    level: "info" | "warn" | "error" | "debug";
    msg: string;
    [k: string]: unknown;
};
export declare function log(level: LogEntry["level"], msg: string, extra?: Record<string, unknown>): Promise<void>;
export declare const logger: {
    info: (msg: string, extra?: Record<string, unknown>) => Promise<void>;
    warn: (msg: string, extra?: Record<string, unknown>) => Promise<void>;
    error: (msg: string, extra?: Record<string, unknown>) => Promise<void>;
    debug: (msg: string, extra?: Record<string, unknown>) => Promise<void>;
};
//# sourceMappingURL=log.d.ts.map