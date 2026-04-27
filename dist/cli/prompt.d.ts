export declare function ask(question: string, defaultValue?: string): Promise<string>;
export declare function askChoice<T extends string>(question: string, choices: T[], defaultIdx?: number): Promise<T>;
export declare function askYesNo(question: string, defaultYes?: boolean): Promise<boolean>;
//# sourceMappingURL=prompt.d.ts.map