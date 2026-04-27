export interface HandoverIndexEntry {
    ts: string;
    sessionID: string;
    path: string;
    goalOneliner: string;
    ctxAtSave: number;
    ctxWindow: number;
    stickyFloor: string | null;
    goal: string;
    emergency: boolean;
}
export declare function listHandovers(limit?: number): Promise<HandoverIndexEntry[]>;
export declare function readHandoverDoc(path: string): Promise<string>;
export declare function getLastHandover(): Promise<HandoverIndexEntry | null>;
//# sourceMappingURL=resume.d.ts.map