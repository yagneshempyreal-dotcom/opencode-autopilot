import type { ProxyContext } from "./context.js";
export interface ProxyServer {
    close(): Promise<void>;
    port: number;
}
export declare function startProxy(ctx: ProxyContext): Promise<ProxyServer>;
//# sourceMappingURL=server.d.ts.map