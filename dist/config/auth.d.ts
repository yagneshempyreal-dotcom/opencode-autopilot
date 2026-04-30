import type { OpenCodeAuth, AuthEntry } from "../types.js";
export declare const AUTH_PATH: string;
export declare function loadAuth(path?: string): Promise<OpenCodeAuth>;
export declare function getCredential(auth: OpenCodeAuth, provider: string): AuthEntry | null;
export declare function loadEffectiveAuth(opts?: {
    authPath?: string;
    opencodePath?: string;
    baseAuth?: OpenCodeAuth;
}): Promise<OpenCodeAuth>;
export declare function bearerToken(entry: AuthEntry | null): string | null;
export declare function isOAuthExpired(entry: AuthEntry | null): boolean;
//# sourceMappingURL=auth.d.ts.map