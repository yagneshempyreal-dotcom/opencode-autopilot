export class ProxyEventBus {
    listeners = [];
    on(listener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }
    emit(e) {
        for (const l of this.listeners) {
            try {
                l(e);
            }
            catch { /* ignore listener errors */ }
        }
    }
}
//# sourceMappingURL=context.js.map