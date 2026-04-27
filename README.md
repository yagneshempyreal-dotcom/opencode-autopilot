# opencode-autopilot

[![tests](https://img.shields.io/badge/tests-139%20passing-brightgreen)](./tests) [![coverage](https://img.shields.io/badge/coverage-89%25-brightgreen)](./tests) [![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

Automatic model routing plugin for [opencode](https://opencode.ai). Picks the best available LLM per prompt — free or paid — optimized for your chosen goal: **cost**, **quality**, or **balance**. Handles auto-handover when a session approaches the model's context-window limit.

## Why

opencode lets you configure many providers (OpenAI, Anthropic, OpenRouter, Zhipu, DeepSeek, free models, …) but you have to pick one model per session. Trivial prompts waste premium tokens; hard prompts get under-served by cheap models.

`opencode-autopilot` fixes that. One model selector — `router/auto` — and the plugin handles the rest.

## Features

- **First-run wizard** — pick optimization goal once: Cost / Quality / Balance / Custom.
- **Per-prompt routing** — hybrid classifier (heuristic + free-LLM triage on ambiguous prompts).
- **Sticky upgrade** — say "this is wrong" or `/upgrade` to bump the tier floor for the rest of the session.
- **Auto-escalate on failure** — free model rate-limited? plugin falls back to cheapest paid automatically.
- **Manual override** — inline `@gpt-5 ...` for one-shot or `/auto off` to disable for the session.
- **Auto-classify model pool** — scans your `auth.json` + `opencode.json`, tiers models into free / cheap-paid / top-paid.
- **Per-turn badge** — `[router → free / nemotron-3-super-free]` so you always know what ran.
- **Auto-handover** — when the session nears context-window limit, writes a structured handover doc and (optionally) auto-resumes in a fresh session with full continuity.
- **Cross-platform** — Linux / macOS / Windows. Honors XDG dirs and Windows APPDATA.

## Architecture (high level)

```
opencode TUI
   │  user picks model: "router/auto"
   ▼
opencode-autopilot plugin
   ├── registers provider via opencode plugin API
   ├── spawns local OpenAI-compat proxy (127.0.0.1:<port>)
   ├── classifier (heuristic + triage)  →  policy engine  →  forwarder
   └── streams response back to opencode, prepending badge
```

Full design at [`docs/specs/2026-04-27-opencode-autopilot-design.md`](docs/specs/2026-04-27-opencode-autopilot-design.md).

## Install

```bash
npm install -g opencode-autopilot
```

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-autopilot"]
}
```

Run the wizard:

```bash
opencode-autopilot init
```

Open opencode, pick model `router/auto`, and start prompting.

## CLI

```bash
opencode-autopilot init           # interactive first-run setup
opencode-autopilot status         # current goal, tiers, prefs
opencode-autopilot tiers          # re-scan and refresh tier classification
opencode-autopilot resume         # list and resume from a saved handover
opencode-autopilot resume --last  # resume the most recent automatically
opencode-autopilot handovers      # list saved handover docs
opencode-autopilot quiet          # disable per-turn badge
opencode-autopilot verbose        # enable per-turn badge
```

## In-session controls

| Trigger | Effect |
|---|---|
| `@gpt-5 ...` | force this prompt to use `gpt-5` (or any provider/modelID) |
| `/upgrade` or "this is wrong" / "try again" | sticky-bump the tier floor for the rest of the session |
| `/router reset` | clear sticky floor |
| `/auto off` / `/auto on` | disable / re-enable router |
| `/router resume` | inject the most recent handover doc into this session |

## Configuration

`~/.config/opencode/autopilot.json` (or `%APPDATA%\opencode\autopilot.json` on Windows):

```json
{
  "goal": "balance",
  "tiers": {
    "free": ["opencode/nemotron-3-super-free"],
    "cheap-paid": ["openai/gpt-5.4-mini"],
    "top-paid": ["openai/gpt-5.4", "deepseek/deepseek-reasoner"]
  },
  "proxy": { "port": 4317, "host": "127.0.0.1" },
  "ux": { "badge": true },
  "triage": { "enabled": true },
  "handover": {
    "enabled": true,
    "thresholdWarn": 0.70,
    "thresholdSave": 0.80,
    "thresholdEmergency": 0.92,
    "mode": "replace",
    "autoResume": false,
    "summaryModel": "policy"
  }
}
```

### Environment overrides (for testing / sandbox setups)

| Variable | Purpose |
|---|---|
| `OPENCODE_AUTOPILOT_CONFIG_PATH` | override autopilot.json location |
| `OPENCODE_AUTOPILOT_LOG_PATH` | override log location |
| `OPENCODE_AUTOPILOT_HANDOVER_DIR` | override handover dir |
| `OPENCODE_AUTH_PATH` | override opencode auth.json path |
| `OPENCODE_CONFIG_PATH` | override opencode.json path |
| `OPENCODE_AUTOPILOT_DEBUG=1` | print log lines to stderr |
| `OPENCODE_AUTOPILOT_AUTO_RESUME=1` | inject most recent handover into new sessions automatically |

## Goal matrix

|        | Low complexity | Medium | High |
|--------|----------------|--------|------|
| **cost**    | free | free | cheap-paid |
| **balance** | free | cheap-paid | top-paid |
| **quality** | cheap-paid | top-paid | top-paid |

Auto-classification rules (feel free to override in config):

- `*:free`, `*-free`, `*-free/*` → **free**
- mini / nano / haiku / flash / turbo / small / -codex- → **cheap-paid**
- opus / gpt-5 / gpt-4o / o1 / o3 / reasoner / glm-4-plus / sonnet-4+ / gemini-pro / gemini-advanced → **top-paid**
- unknown → **cheap-paid** (flagged for user review)

## Testing

```bash
npm test                # 130+ unit + integration tests
npm test -- --coverage  # coverage report
npm run typecheck       # strict TypeScript
```

Manual QA checklist: [`tests/manual.md`](tests/manual.md).

## Status

- [x] Design spec
- [x] Plugin entry + opencode hooks
- [x] Local proxy (Bun/Node compatible HTTP server)
- [x] Classifier (heuristic + LLM-triage hybrid)
- [x] Policy engine (goal × tier × sticky × override)
- [x] Auto-classifier model registry
- [x] Per-provider forwarders (OpenAI-compat, Anthropic)
- [x] Setup CLI with first-run wizard
- [x] Context monitor + handover generator + resume
- [x] Cross-platform path resolution (XDG / Windows APPDATA)
- [x] 139 automated tests, 89% coverage

## License

MIT
