# opencode-autopilot — Design Spec

**Date**: 2026-04-27
**Status**: Draft (awaiting user review)
**Project**: opencode-autopilot — automatic model routing plugin for [opencode](https://opencode.ai)

---

## 1. Goal

A drop-in opencode plugin that automatically selects the best LLM per prompt from the user's available providers (free + paid), optimized for a user-chosen objective (cost / quality / balance). Saves tokens, improves results, and adds session-handover continuity when the active model nears its context-window limit.

## 2. User-facing behavior

**First run** — `opencode-autopilot init` walks user through:

1. Pick optimization goal:
   - **Cost** — prefer free models, escalate only when needed.
   - **Quality** — pick best model per task, ignore cost.
   - **Balance** — free for trivial, paid mid-tier for normal, top-tier for hard.
   - **Custom** — manual mapping.
2. Auto-classify available models (scan `~/.local/share/opencode/auth.json` + `~/.config/opencode/opencode.json`) into tiers: `free`, `cheap-paid`, `top-paid`. Show preview, allow edit.
3. Configure handover: warn threshold, save threshold, auto-resume on/off, summarization model.
4. Privacy: opt out of free-LLM triage calls if desired.

**Per prompt** — user just types as usual with model set to `router/auto`:

- Plugin classifies complexity (heuristic; LLM-triage when ambiguous).
- Policy engine maps `(goal, complexity, sticky-floor, override) → modelID`.
- Forwarder routes to chosen provider using existing opencode auth.
- Response prefixed with badge: `[router → free / nemotron-3-super-free]` (mutable via `/router quiet`).

**Manual override**:

- Inline tag in prompt: `@gpt-5 fix this` → uses gpt-5 just this turn.
- Slash commands: `/auto off` (disable router for session), `/upgrade` (sticky bump tier), `/router resume`, `/router status`, `/router tiers`, `/router quiet`.

**Sticky upgrade**: explicit user signal (`/upgrade` or phrases like "this is wrong", "try again") bumps the tier floor for the rest of the session.

**Free-tier failure**: auto-escalate to cheapest paid tier; warning badge shown.

**Auto-handover**: when context utilization crosses threshold, write structured handover doc, archive session, optionally auto-resume in fresh session with handover injected.

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  opencode TUI                                                │
│  user picks model: "router/auto"                             │
└────────────────────┬─────────────────────────────────────────┘
                     │ OpenAI-compat request
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  opencode-autopilot  (plugin, runs in opencode process)      │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐              │
│  │ Provider   │  │ chat.msg   │  │ Setup CLI  │              │
│  │ hook:      │  │ hook:      │  │ (init,     │              │
│  │ register   │  │ badge +    │  │ wizard)    │              │
│  │ router/auto│  │ sticky     │  │            │              │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘              │
│        │ spawn         │ session       │ writes              │
│        ▼               ▼ state         ▼                     │
│  ┌──────────────────────────────────────────────────┐        │
│  │ Local Proxy (HTTP, 127.0.0.1:<port>)             │        │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │        │
│  │  │Classifier│→ │ Policy   │→ │ Forwarder    │    │        │
│  │  │(heur+LLM)│  │ Engine   │  │ (auth.json)  │    │        │
│  │  └──────────┘  └──────────┘  └──────┬───────┘    │        │
│  │                                     │             │        │
│  │  ┌─────────────────────────────────────────────┐ │        │
│  │  │ Context Monitor + Handover                  │ │        │
│  │  │ (tracks tokens, triggers handover)          │ │        │
│  │  └─────────────────────────────────────────────┘ │        │
│  └─────────────────────────────────────┼────────────┘        │
└────────────────────────────────────────┼─────────────────────┘
                                         │
                ┌────────────────────────┼────────────────────┐
                ▼                        ▼                    ▼
          openrouter API           zhipuai API           openai API
```

**Per-prompt flow**:

1. opencode → POST `localhost:<port>/v1/chat/completions` (model: `auto`).
2. Classifier scores complexity (heuristic; LLM-triage for ambiguous).
3. Policy engine: `(goal × complexity × sticky-state) → tier → model`.
4. Forwarder rewrites for target provider, uses creds from `auth.json`, streams SSE response.
5. Plugin's `chat.message` hook prepends badge.
6. Failure of free tier → auto-escalate. User signal "wrong/try again/`/upgrade`" → sticky-upgrade tier for session.

## 4. Components

### 4.1 Setup CLI — `opencode-autopilot`

Subcommands:
- `init` — interactive wizard (goal pick, auto-classify confirm, handover prefs, privacy).
- `status` — current goal, sticky state, recent telemetry.
- `tiers` — re-classify model pool.
- `resume [--last]` — list handovers and resume.
- `handovers` — list saved handover docs.
- `handover-now` — force handover at current point.
- `quiet` / `verbose` — toggle per-turn badge.

Writes `~/.config/opencode/autopilot.json`.

### 4.2 Plugin module

Implements `@opencode-ai/plugin` `Plugin` export. Hooks:
- `provider` — registers `router` provider, model `auto`. Models endpoint points to local proxy.
- `chat.message` — reads sticky session state, prepends badge, watches for explicit signals (`/upgrade`, "this is wrong", "try again") to bump sticky tier.
- `experimental.chat.system.transform` — on resume, prepends handover content to system prompt.
- `experimental.session.compacting` — replace mode: suppress opencode default, run plugin handover instead.
- `config` — ensures `router/auto` available, reads user policy.
- On load: spawns proxy if not running.

### 4.3 Local Proxy

Bun HTTP server. Endpoint: `POST /v1/chat/completions` (OpenAI-compat). Routes via classifier → policy → forwarder. Streams SSE response unmodified. Lives in plugin process, dies with opencode.

### 4.4 Classifier

Signature: `score(prompt, context) → {tier: "low"|"medium"|"high", confidence: 0–1}`.

**Heuristic**: prompt length, attached files count, code-block count, keyword set (high: `architecture`, `refactor`, `debug`, `optimize`, `concurrency`, `migration`, `security`; low: `typo`, `rename`, `format`, `comment`).

**LLM triage** (only when confidence < 0.7 AND goal != Quality): cheapest free model with prompt `"rate task complexity 1-10, single integer only"`.

### 4.5 Policy Engine

Maps `(goal, complexity, sticky_floor, override) → modelID`.

| Goal | Low | Medium | High |
|---|---|---|---|
| Cost | free | free | cheap-paid |
| Balance | free | cheap-paid | top-paid |
| Quality | cheap-paid | top-paid | top-paid |

Effective tier = `max(classifier_tier, sticky_floor)`. Inline override bypasses entirely.

### 4.6 Model Registry

Auto-classifies on `init` and on `tiers` re-scan. Rules:

- `*:free` or `*-free` substring → `free`.
- Known cheap (`gpt-5.4-mini`, `claude-haiku-*`, `gemini-flash-*`) → `cheap-paid`.
- Reasoning/large (`opus`, `gpt-5`, `deepseek-reasoner`, `glm-4-plus`) → `top-paid`.
- Unknown → `cheap-paid` default + flagged for user confirmation.

Each registry entry stores: `{ provider, modelID, tier, ctx_window, supports_streaming }`.

### 4.7 Forwarder

Per-provider adapter (zhipuai, openrouter, openai, deepseek, opencode, …). Reads `auth.json` for keys/tokens. Translates incoming OpenAI-format request to provider's native API. Streams response. Retries with escalation on free-tier failure (rate limit / 5xx).

### 4.8 Config Store

`~/.config/opencode/autopilot.json`:

```json
{
  "goal": "balance",
  "tiers": {
    "free": ["opencode/nemotron-3-super-free", "openrouter/google/gemma-4-26b-a4b-it:free"],
    "cheap-paid": ["openai/gpt-5.4-mini", "openrouter/x-ai/grok-code-fast-1"],
    "top-paid": ["openai/gpt-5.4", "deepseek/deepseek-reasoner", "zhipuai/glm-4-plus"]
  },
  "proxy": { "port": 4317 },
  "ux": { "badge": true },
  "triage": { "enabled": true },
  "handover": {
    "enabled": true,
    "threshold_warn": 0.70,
    "threshold_save": 0.80,
    "threshold_emergency": 0.92,
    "mode": "replace",
    "auto_resume": false,
    "summary_model": "policy"
  }
}
```

Session state (in-memory, keyed by `sessionID`): `sticky_floor`, `last_signal_at`, `prompt_count`, `tokens_used_estimate`.

### 4.9 Context Monitor + Handover

**Monitor** (in proxy/forwarder): tracks running token total per `sessionID` (input + cumulative output). Computes utilization vs current model's ctx-window. Threshold transitions:
- ≥ 0.70 → soft warn badge.
- ≥ 0.80 → trigger handover before next generation.
- ≥ 0.92 → emergency handover (skip optional summary calls).

**Handover generator**: pulls full transcript via opencode `client`. Calls policy-engine for summarization model. Writes structured markdown to `~/.opencode/handovers/<YYYY-MM-DD>-<sessionID>.md`. Appends to `~/.opencode/handovers/INDEX.jsonl`.

**Handover doc structure**:

```markdown
# Session Handover — <sessionID> — <ISO timestamp>

## Goal
<one paragraph from first prompt + clarifications>

## Decisions made
- <bullet>

## Files touched
- path:line — what changed and why

## Current state
We just finished: <X>. Next step: <Y>.

## Open todos
- [ ] <item>

## Key context (verbatim quotes that matter)
> <snippet>

## Recent transcript (last 10 turns, verbatim)
...

## Session metadata
- Models used: <list with turn counts and est tokens>
- Sticky floor at handover: <tier>
- Goal: <user goal>
```

**Session close**: plugin posts final message `🏁 Handover saved → <path>. Run /router resume to continue.`, marks session archived, drops it.

**Resume flow**: `/router resume` (slash) or `opencode-autopilot resume` (CLI). Lists recent handovers; user picks. Plugin spawns fresh opencode session, injects handover via `experimental.chat.system.transform`. Sticky tier restored from handover metadata. Badge: `[router ↻ resumed from <handover>, ctx fresh]`.

**Auto-resume**: if `auto_resume: true`, plugin immediately starts fresh session with handover injected after save. User sees `[router ↻ rolled over]`.

**Compaction modes**:
- `replace` (default): plugin owns compaction; opencode default suppressed.
- `augment`: opencode compacts in-place; plugin only triggers handover at 0.92.

## 5. Data flow

### 5.1 Per-prompt sequence

```
1. user types "fix typo in README"
2. opencode → POST /v1/chat/completions { model: "auto", ... }
3. classifier: len=22, files=0, no_complex_kw → low conf=0.95
4. policy (goal=Cost, sticky=null, override=null): low → free → "opencode/nemotron-3-super-free"
5. forwarder: load creds from auth.json, translate, stream back
6. chat.message hook: prepend "[router → free / nemotron-3-super-free]"
7. response renders in TUI
```

### 5.2 Sticky upgrade

```
1. user: "this is wrong, try again"
2. chat.message hook detects signal
3. session sticky_floor: free → cheap-paid
4. next prompt: max(classifier_tier, sticky_floor)
5. badge: "[router ↑ upgraded / cheap-paid / gpt-5.4-mini]"
6. sticky persists till session end OR /router reset
```

### 5.3 Failure escalation

```
1. forwarder gets 429/5xx from free model
2. retry next free in tier (round-robin)
3. all free fail → escalate to cheap-paid
4. badge: "[router ⚠ free exhausted, escalated to cheap-paid]"
5. log to ~/.local/share/opencode/autopilot.log
```

### 5.4 Handover

```
1. forwarder sees ctx_used / ctx_window ≥ 0.80
2. monitor signals plugin
3. handover generator pulls transcript, summarizes
4. doc written to ~/.opencode/handovers/...
5. plugin posts final message in current session
6. session archived
7. (if auto_resume) fresh session opened, handover injected
```

## 6. Error handling

| Failure | Handling |
|---|---|
| Free 429 | Retry next free; all fail → escalate to cheap-paid + warn badge. |
| Provider 5xx | Same as above. |
| Auth missing/expired | Skip model in registry. Tier empty → escalate. Surface `opencode auth login <provider>`. |
| Proxy port in use | Try next port, update config, log. |
| Triage call fails | Heuristic-only, confidence floored at 0.5. |
| Forwarder >60s no first byte | Abort, escalate one tier. |
| `auth.json` unreadable | Plugin disables, surfaces error. User runs `opencode-autopilot init`. |
| Config corrupted | Backup, regenerate from defaults, prompt re-init. |
| Stream chunk malformed | Pass through; don't repair. |
| Handover gen fails | Fall back to raw last-30-turns dump + minimal heuristic summary. Never lose data. |
| Handover doc too large for fresh ctx | Tier-up to bigger-window model OR trim recent-transcript section. |

## 7. Edge cases

- Empty/whitespace prompt → low, no triage.
- Very long context (>50KB) → force high regardless of keywords.
- Ctx-window mismatch: registry stores ctx-window; policy filters tier members. None fit → escalate.
- Inline override (`@model ...`): regex strip from prompt, force model, bypass classifier+policy. Badge: `[router → manual / <model>]`.
- `/auto off`: pass through opencode's selected model unchanged till `/auto on`.
- Mid-stream cut: surface partial + error, no auto-retry.
- Concurrent sessions: sticky state keyed per `sessionID`, no cross-talk.
- Zero free models in `auth.json`: wizard warns, router operates on paid tiers only.
- Provider added later: `tiers` re-scans, plugin auto-reloads.
- Privacy: triage prompts go to free LLM. Wizard surfaces; opt-out (`triage: false` → heuristic-only).

## 8. Testing strategy

### 8.1 Unit (`tests/unit/`)

| Module | Tests |
|---|---|
| Classifier | Short typo → low; "refactor architecture" → high; long ctx → high; ambiguous → confidence < 0.7 → triage. Mock triage. |
| Policy | Each (goal × tier × sticky × override) → expected model. Sticky floor never below classifier. Inline override bypasses. |
| Registry | `nemotron-3-super-free` → free; `gpt-5.4-mini` → cheap; `glm-4-plus` → top; unknown → cheap+flagged. |
| Forwarder | Per-provider request translation snapshots. SSE passthrough. 429 retry. All-free-fail escalation. Auth-missing skip. |
| Context Monitor | Token accounting in+out. Threshold transitions at 0.70/0.80/0.92. Per-session isolation. |
| Handover gen | Markdown structure stable. Trim under window pressure. Fall back to raw dump on summary failure. |
| Config store | Corrupted JSON → backup + regenerate. Round-trip preserves shape. |

### 8.2 Integration (`tests/integration/`)

- Spin up proxy on ephemeral port + mock provider servers.
- Full per-prompt path: classifier → policy → forwarder → SSE. Assert badge prepended.
- Sticky upgrade: send "this is wrong" → next prompt routes upgraded.
- Free exhausted: mock all free 429 → escalation + warn badge.
- Handover trigger: feed turns past threshold → file written + index updated + session archived.
- Resume: invoke `resume` → fresh session has handover as system message.
- Inline `@gpt-5` override.

### 8.3 E2E (`tests/e2e/`, gated `RUN_E2E=1`)

- Real opencode binary headless. Plugin loaded. Free models only ($0).
- Smoke: setup wizard → write config → opencode session prompt → badge appears.
- Resume e2e: force handover, restart, `/router resume`, assert continuity.

### 8.4 Manual QA (`tests/manual.md`)

- Wizard UX. Badge readability. Slash commands. Privacy opt-out (verify no triage traffic). Concurrent windows isolated.

### 8.5 Coverage

- Unit: 90%+ on classifier, policy, registry.
- Integration: all golden paths + each documented failure mode.
- E2E: smoke only.

### 8.6 Test data

- `tests/fixtures/auth.json` — sample 4 providers, mix free/paid.
- `tests/fixtures/transcripts/` — canned sessions for handover.
- `tests/fixtures/prompts.jsonl` — labeled (low/med/high), classifier accuracy target 88%.

## 9. Open questions / future work

- Cost telemetry dashboard (CLI command to summarize savings).
- Per-project goal override (`.opencode/autopilot.json` overrides global).
- Multi-account opencode auth selection.
- Streaming handover (rolling summary while generating, not post-hoc).
