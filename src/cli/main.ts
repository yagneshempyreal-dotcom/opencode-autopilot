#!/usr/bin/env node
import { runCli } from "./router.js";

runCli(process.argv).catch((err) => {
  console.error("Error:", (err as Error).message);
  process.exit(1);
});
