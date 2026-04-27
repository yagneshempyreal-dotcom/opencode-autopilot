import { readFile } from "node:fs/promises";
import { opencodeJsonPath } from "../util/paths.js";
export const OPENCODE_CONFIG_PATH = opencodeJsonPath();
export async function loadOpencodeConfig(path = OPENCODE_CONFIG_PATH) {
    try {
        const raw = await readFile(path, "utf8");
        return JSON.parse(raw);
    }
    catch (err) {
        const e = err;
        if (e.code === "ENOENT")
            return {};
        throw err;
    }
}
//# sourceMappingURL=opencode.js.map