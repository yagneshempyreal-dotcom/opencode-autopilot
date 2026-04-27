import type { RouteDecision, Tier } from "../types.js";

export interface BadgeContext {
  decision: RouteDecision;
  ctxUtilization?: number;
  warnHandover?: boolean;
  resumed?: boolean;
  resumeFrom?: string;
  stickyBumpedTo?: Tier | null;
}

export function formatBadge(ctx: BadgeContext): string {
  const parts: string[] = [];
  if (ctx.resumed) {
    parts.push(`router ↻ resumed${ctx.resumeFrom ? ` from ${shortPath(ctx.resumeFrom)}` : ""}`);
  } else if (ctx.decision.override) {
    parts.push(`router → manual / ${ctx.decision.modelID}`);
  } else if (ctx.decision.escalated) {
    parts.push(`router ⚠ escalated → ${ctx.decision.tier} / ${ctx.decision.modelID}`);
  } else if (ctx.stickyBumpedTo) {
    parts.push(`router ↑ upgraded → ${ctx.stickyBumpedTo} / ${ctx.decision.modelID}`);
  } else {
    parts.push(`router → ${ctx.decision.tier} / ${ctx.decision.modelID}`);
  }

  if (ctx.warnHandover && ctx.ctxUtilization != null) {
    parts.push(`ctx ${Math.round(ctx.ctxUtilization * 100)}%`);
  }

  return `[${parts.join(" · ")}]`;
}

function shortPath(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] ?? p;
}
