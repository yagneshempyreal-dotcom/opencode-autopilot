# opencode-openauto

[![tests](https://img.shields.io/badge/tests-237%20passing-brightgreen)](./tests) [![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

Automatic model routing plugin for [opencode](https://opencode.ai). One virtual model — `openauto/auto` — and the router picks a real LLM per prompt based on your goal (cost / balance / quality), live model health, and the task's expertise needs (code, reasoning, vision, math, …). When a model fails, it gets marked down for ~5 minutes and traffic flows to the next-best candidate without the user noticing.

```
┌──────────────┐    user picks    ┌────────────────────────┐
│  opencode    │ ─── auto ──────▶ │  proxy on :4317        │
│    TUI       │                  │  ├─ classify prompt    │
└──────────────┘                  │  ├─ apply goal matrix  │
        ▲                         │  ├─ filter by health   │
        │                         │  ├─ rank by tags       │
        │  /v1/chat/completions   │  ├─ dispatch + retry   │
        └─────────────────────────┤  └─ mark health        │
                                  └─────────┬──────────────┘
                                            ▼
                            openai · anthropic · deepseek
                            zhipu · openrouter · opencode …
```

Everything is local: no telemetry, no extra service, plugin lives in your opencode process.

---

## Quick start

### 1. Clone & install

```bash
git clone https://github.com/yagneshempyreal-dotcom/opencode-autopilot.git
cd opencode-autopilot

# macOS / Linux
./scripts/setup.sh

# Windows (PowerShell or cmd)
scripts\setup.cmd
```

`setup.sh` / `setup.cmd` writes the plugin entry **and** the `provider.openauto` block into your opencode config. Run it once after cloning, then once more whenever you bump the proxy port. It is idempotent.

### 2. Start opencode

```bash
opencode
```

### 3. Pick the router

In the TUI model picker, choose **OpenAuto / OpenAuto Router**.

### 4. Verify available models (recommended on first start)

The plugin auto-runs verification in the background, but you can drive it explicitly:

```text
router verify
```

This pings every model in your registry (≤8 s each, concurrency 4). Models that respond get pinned automatically — subsequent prompts route only to those.

---

## Commands

All commands are typed as **plain text** in the message box (no leading `/` or `!` — opencode reserves those for its own slash-palette and shell-run). Anchored to the start of a message; prose mentioning "router" later in a sentence won't trigger.

| command | effect |
|---|---|
| `router status` | goal, auto on/off, health summary, pinned models, current matrix |
| `router models` | list every detected model grouped by tier |
| `router verify` | probe all models with a 1-token ping; auto-pin the OK set |
| `router health` | last-known per-model status, latency, last error |
| `router pick all-ok` | pin every model that just passed `verify` |
| `router pick <a/b, c/d>` | pin a specific list (provider/modelID, comma-separated) |
| `router pick clear` | remove the pin (use full registry again) |
| `router goal cost` | low/medium → free, high → cheap-paid |
| `router goal balance` | low → free, medium → cheap-paid, high → top-paid |
| `router goal quality` | low → cheap-paid, medium/high → top-paid |
| `router upgrade` | bump session sticky floor up one tier (rest of session) |
| `router reset` | clear sticky floor |
| `router auto on` / `router auto off` | enable / disable router (per session) |
| `@provider/modelID …` | per-message override — bypass router for this turn |

Aliases: `#router`, `:router`, `>router`, `/router` all map to the same handler — pick whichever your TUI passes through.

---

## How routing works

For every chat completion that opencode sends to `openauto/auto`:

1. **Classify** the prompt complexity (low / medium / high) using a heuristic on length, code blocks, attached files, and keywords. Optionally calls a free LLM for triage on ambiguous cases.
2. **Map** complexity → tier via the current goal matrix (see "Goals" below).
3. **Filter** the candidate pool:
   - User allowlist if set (`router pick`)
   - Context-window fit (model has room for prompt + response)
   - Health (skip models marked `down` within back-off window)
4. **Rank** survivors by capability tag overlap with the inferred task tags (code, reasoning, vision, math, fast, long-ctx).
5. **Dispatch** to the top candidate. On failure: mark down, fall through to the next one. Cascades upward (cost → quality) **and** downward (quality → cost) so a 503 only happens when literally every model in the registry is dead.
6. **Health-check** records to `~/.local/state/opencode/openauto-health.json`. Quota-style failures (402, 429, "insufficient balance") get a longer 60-min back-off; transient errors retry after 5 min.

A per-attempt 60 s timeout means a hung model can't freeze the dispatch.

---

## Goals at a glance

| Goal | low complexity | medium | high |
|---|---|---|---|
| `cost` | free | free | cheap-paid |
| `balance` | free | cheap-paid | top-paid |
| `quality` | cheap-paid | top-paid | top-paid |

Switch any time mid-session: `router goal balance`. Persists to `~/.config/opencode/autopilot.json`.

---

## Capability tags

Every model in the registry gets one or more tags inferred from its name:

| tag | matches | bias for |
|---|---|---|
| `code` | gpt-codex, deepseek-coder, code-fast | code generation, debugging |
| `reasoning` | o1, opus, glm-4-plus, deep-think | architecture, root cause |
| `math` | reasoner, qwen-math | proofs, derivations |
| `vision` | -vl-, gpt-4o, sonnet, opus | image / diagram input |
| `fast` | mini, nano, haiku, flash, turbo | trivial / short-tldr asks |
| `long-ctx` | 1m, 200k, sonnet, opus | very long inputs |
| `chat` | default | everything else |

Each request also gets task tags from the prompt text (heuristics on keywords like `function`, `derivative`, `screenshot`, `quick`, …). Within a tier, the router prefers candidates whose tags overlap with the task tags.

---

## Health & verify

The plugin keeps a per-model health record:

```json
{
  "openai/gpt-5.4-mini": {
    "status": "ok",
    "lastChecked": 1777359130005,
    "latencyMs": 412,
    "consecutiveFails": 0
  },
  "deepseek/deepseek-v4-pro": {
    "status": "down",
    "lastChecked": 1777359124603,
    "consecutiveFails": 1,
    "lastError": "Insufficient Balance",
    "quotaError": true
  }
}
```

Persisted at `~/.local/state/opencode/openauto-health.json`.

Sources of updates:

- **Background warm-up** on plugin start when the file is empty or older than 6 h.
- **Explicit `router verify`** — full re-probe + auto-pin OK set.
- **Live traffic** — every dispatch attempt records its outcome.

---

## File layout

```
~/.config/opencode/opencode.json     ← plugin entry + openauto provider block
~/.config/opencode/autopilot.json    ← goal, allowlist, tier overrides, port
~/.local/share/opencode/auth.json    ← provider API keys (managed by opencode)
~/.local/share/opencode/autopilot.log ← runtime log
~/.local/state/opencode/openauto-health.json ← per-model health
~/.local/state/opencode/model.json   ← opencode's recent-model state
```

---

## Updating

```bash
cd opencode-autopilot
git pull
./scripts/refresh.sh
```

`refresh.sh` kills any running opencode, clears the plugin / bun caches, truncates the autopilot log, and prints next-step instructions. Pass `--yes` to skip prompts.

---

## Troubleshooting

**`OpenAuto Router` not in the model picker.** Run `./scripts/setup.sh` once. If you already ran it, quit and restart opencode — the picker reads `opencode.json` at boot.

**Every prompt routes to one model.** That's the point — within the tier the goal matrix selected, the highest-ranked healthy candidate wins. Switch goal (`router goal quality`) to push toward different tiers. Or run `router pick provider/m1, provider/m2` to constrain the pool.

**Cascade through dead paid models is slow.** Run `router verify` once (or wait for the background warm-up); the OK set gets auto-pinned and dead models get a 60-min back-off if they returned a quota / billing error.

**Plugin loaded an old commit.** opencode caches the resolved git commit in `~/.cache/opencode/packages/`. After `git pull`, run `./scripts/refresh.sh` to clear caches and force a re-fetch.

**Self-loop ("router routes to openauto/auto").** Filtered out automatically — the proxy never picks its own provider as a target.

**`gpt-5-nano` showing as top-paid.** Names containing `mini / nano / tiny / small / haiku / flash / turbo / fast` are always cheap-paid regardless of family.

**Multi-line prompts not triggering router commands.** Commands are anchored to the start of the message; a `router status` mid-message won't fire. Put them on their own line at the start.

---

## Security model

- The plugin runs in-process inside opencode; no external network listener besides the loopback proxy on `:4317`.
- API keys are read from opencode's existing `auth.json`; the plugin never writes credentials.
- The proxy listens on `127.0.0.1` only.
- Health probes use the same auth as live traffic — no extra secrets.

---

## Contributing

`main` is protected: pushes go through pull requests. Fork, branch, PR. The repo owner is the only direct-push collaborator. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow.

---

## License

MIT — see [LICENSE](./LICENSE).
