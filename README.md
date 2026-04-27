# opencode-autopilot

Automatic model routing plugin for [opencode](https://opencode.ai). Picks the best available LLM per prompt — free or paid — optimized for your chosen goal: **cost**, **quality**, or **balance**.

> Status: design complete, implementation in progress. See [`docs/specs/`](docs/specs).

## Why

opencode lets you configure many providers (OpenAI, Anthropic, OpenRouter, Zhipu, DeepSeek, free models, …) but you have to pick one model per session. Trivial prompts waste premium tokens; hard prompts get under-served by cheap models.

`opencode-autopilot` fixes that. One model selector — `router/auto` — and the plugin handles the rest.

## Features

- **First-run wizard** — pick goal once: Cost / Quality / Balance.
- **Per-prompt routing** — hybrid classifier (heuristic + free-LLM triage on ambiguous cases).
- **Sticky upgrade** — say "this is wrong" or `/upgrade` to bump the tier floor for the rest of the session.
- **Auto-escalate on failure** — free model rate-limited? falls back to cheapest paid automatically.
- **Manual override** — inline `@gpt-5 ...` for one-shot or `/auto off` to disable for the session.
- **Auto-classify model pool** — scans your `auth.json` + `opencode.json`, tiers models into free / cheap / top.
- **Per-turn badge** — `[router → free / nemotron-3-super-free]` so you always know what ran.
- **Auto-handover** — when the session nears the model's context-window limit, writes a structured handover doc and (optionally) auto-resumes in a fresh session with full continuity.

## Install (planned)

```bash
# add to ~/.config/opencode/opencode.json plugins:
"plugin": ["opencode-autopilot@npm"]

# first run
opencode-autopilot init
```

## Status

- [x] Design spec ([docs/specs/2026-04-27-opencode-autopilot-design.md](docs/specs/2026-04-27-opencode-autopilot-design.md))
- [ ] Implementation plan
- [ ] Plugin scaffold
- [ ] Classifier
- [ ] Policy engine
- [ ] Model registry + auto-classifier
- [ ] Local proxy + forwarders
- [ ] Setup CLI
- [ ] Context monitor + handover
- [ ] Tests

## License

MIT
