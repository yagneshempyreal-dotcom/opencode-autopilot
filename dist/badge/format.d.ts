import type { RouteDecision, Tier } from "../types.js";
export interface BadgeContext {
    decision: RouteDecision;
    ctxUtilization?: number;
    warnHandover?: boolean;
    resumed?: boolean;
    resumeFrom?: string;
    stickyBumpedTo?: Tier | null;
}
export declare function formatBadge(ctx: BadgeContext): string;
//# sourceMappingURL=format.d.ts.map