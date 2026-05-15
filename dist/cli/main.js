#!/usr/bin/env node
import { runCli } from "./router.js";
runCli(process.argv).catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
});
//# sourceMappingURL=main.js.map