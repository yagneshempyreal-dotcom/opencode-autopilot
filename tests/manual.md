# Manual QA Checklist

Automated tests cover unit + integration. The items below need a human in the loop because they involve live opencode TUI behavior, real provider keys, or interactive UX.

## First-run setup

- [ ] `opencode-autopilot init` runs to completion and writes `~/.config/opencode/autopilot.json`.
- [ ] On a system with **zero** providers configured, the wizard warns and still completes.
- [ ] On a system with **only paid** providers, free tier is empty in summary; wizard does not crash.
- [ ] Choosing each goal (cost / quality / balance / custom) writes the correct value.
- [ ] Manual tier-edit prompt accepts comma-separated lists, trims whitespace.

## Routing in opencode

- [ ] Pick model `router/auto` in opencode TUI; first prompt receives a response.
- [ ] Badge prefix appears at the top of every response unless `quiet` is set.
- [ ] `opencode-autopilot quiet` disables badge on next prompt.
- [ ] `opencode-autopilot verbose` re-enables it.

## Sticky upgrade

- [ ] Send a trivial prompt → free model.
- [ ] Reply "this is wrong, try again" → next prompt uses cheap-paid model. Badge shows `↑ upgraded`.
- [ ] Repeat → next jump is top-paid. Capped there.
- [ ] `/router reset` returns sticky floor to none.

## Manual override

- [ ] `@anthropic/claude-haiku-4-5 ...` routes that one prompt to that exact model. Badge shows `manual`.
- [ ] `@unknown/nope` falls back to policy routing (no crash).
- [ ] `/auto off` causes router to refuse next prompt with a 503-style error.
- [ ] `/auto on` re-enables.

## Failure paths

- [ ] Disconnect from network, send prompt. Badge shows escalation attempts; final 502 if all fail.
- [ ] Revoke a provider's auth (delete its entry in `auth.json`); next prompt skips it cleanly and escalates.

## Auto-handover

- [ ] Start a long session. Verify warn badge appears at ~70% utilization.
- [ ] At 80%, handover doc is written to `~/.opencode/handovers/`. Index `INDEX.jsonl` updated.
- [ ] `opencode-autopilot handovers` lists it.
- [ ] `opencode-autopilot resume` shows the doc content.
- [ ] With `OPENCODE_AUTOPILOT_AUTO_RESUME=1`, opening a fresh session pre-loads the most recent handover as system context.

## Privacy

- [ ] With `triage.enabled=false` in config, monitor outbound traffic — confirm zero requests to a free LLM for triage.
- [ ] With `triage.enabled=true`, an ambiguous medium-length prompt does emit a triage call.

## Cross-platform sanity

- [ ] On Linux without `XDG_CONFIG_HOME` set, default `~/.config` is used.
- [ ] On Linux with `XDG_CONFIG_HOME=/some/path`, config goes there.
- [ ] On macOS, default paths under `~/.config` and `~/.local/share` are used.
- [ ] On Windows (PowerShell), `%APPDATA%` and `%LOCALAPPDATA%` paths are used; `init` writes to `%APPDATA%\opencode\autopilot.json`.
- [ ] CLI `init` interactive prompts work on both bash and PowerShell.

## Concurrency

- [ ] Open two opencode windows simultaneously. Send a sticky-upgrade signal in window A. Window B's session should be unaffected (its sticky state is independent).

## Port handling

- [ ] If the configured proxy port is already in use, plugin tries the next 19 ports and logs the chosen one.
- [ ] If port 0 is configured, OS assigns one and config is updated.
