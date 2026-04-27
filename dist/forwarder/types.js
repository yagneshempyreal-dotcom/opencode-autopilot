export class ForwardError extends Error {
    status;
    detail;
    retriable;
    constructor(status, detail, retriable) {
        super(`forward ${status}: ${detail}`);
        this.status = status;
        this.detail = detail;
        this.retriable = retriable;
    }
}
export function isRetriableStatus(status) {
    return status === 408 || status === 429 || (status >= 500 && status < 600);
}
//# sourceMappingURL=types.js.map