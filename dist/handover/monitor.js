export function evaluate(utilization, cfg) {
    if (!cfg.enabled)
        return utilization >= cfg.thresholdEmergency ? "emergency" : "ok";
    if (utilization >= cfg.thresholdEmergency)
        return "emergency";
    if (utilization >= cfg.thresholdSave)
        return "save";
    if (utilization >= cfg.thresholdWarn)
        return "warn";
    return "ok";
}
export function shouldTriggerSave(level) {
    return level === "save" || level === "emergency";
}
//# sourceMappingURL=monitor.js.map