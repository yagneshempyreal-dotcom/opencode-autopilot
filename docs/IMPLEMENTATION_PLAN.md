# opencode-autopilot — Implementation Plan

**Status**: Most phases complete. Live verification is the remaining blocker.
**Spec**: [`docs/specs/2026-04-27-opencode-autopilot-design.md`](specs/2026-04-27-opencode-autopilot-design.md)
**Repo**: https://github.com/yagneshempyreal-dotcom/opencode-autopilot

Each phase lists every file touched and the acceptance signal that says "this phase is done."

---

## Phase 0 — Project scaffold ✅

**Goal**: TS + Node 20+, ESM, vitest, strict tsconfig, repo wired to GitHub.

| Step | File | Done |
|---|---|---|
| `package.json` with peer deps + bin entry | `package.json` | ✅ |
| Strict TS config | `tsconfig.json` | ✅ |
| Vitest config | `vitest.config.ts` | ✅ |
| Folder skeleton | `src/{classifier,policy,registry,forwarder,proxy,handover,config,session,badge,util,cli}` + `tests/{unit,integration,fixtures}` | ✅ |
| MIT license + .gitignore | `LICENSE`, `.gitignore` | ✅ |
| Repo created, public, pushed | GitHub | ✅ |

**Acceptance**: `npm install && npx tsc --noEmit` succeeds, `npx vitest run` finds 0 tests but exits 0.

---

## Phase 1 — Config + auth I/O ✅

**Goal**: Cross-platform path helpers + autopilot config and opencode auth/config readers.

| Step | File | Done |
|---|---|---|
| XDG / Windows APPDATA path helpers + env-override | `src/util/paths.ts` | ✅ |
| autopilot.json read/write with corrupt-backup fallback | `src/config/store.ts` | ✅ |
| `auth.json` reader + `bearerToken()` extractor for api/oauth/wellknown | `src/config/auth.ts` | ✅ |
| `opencode.json` reader (provider + plugin shape) | `src/config/opencode.ts` | ✅ |
| Logger to JSON-line file with stderr debug branch | `src/util/log.ts` | ✅ |
| Token estimator (chars/3.8) | `src/util/tokens.ts` | ✅ |

**Acceptance**: Tests cover load with missing/corrupt files, env overrides, Windows path branch. 100% line coverage on these files.

---

## Phase 2 — Model registry + auto-classifier ✅

**Goal**: Scan auth + opencode config (+ recent-models state + autopilot tier list) and tier each model.

| Step | File | Done |
|---|---|---|
| Regex tier classifier (free / cheap-paid / top-paid) | `src/registry/classify.ts` | ✅ |
| Inferred ctx-window per model + per-provider API shape | `src/registry/classify.ts` | ✅ |
| Registry build from auth × opencode.json × recent-state × autopilot.tiers | `src/registry/index.ts` | ✅ |
| Lookup by `provider/modelID` and bare `modelID` | `src/registry/index.ts` | ✅ |
| Flag unknown models for user review | `src/registry/index.ts` | ✅ |

**Acceptance**: Unit tests cover all tier patterns and seed sources. 100% line coverage on `classify.ts`, ≥ 97% on `registry/index.ts`.

---

## Phase 3 — Classifier (heuristic + triage) ✅

**Goal**: Score user prompt complexity → low/medium/high with a confidence value.

| Step | File | Done |
|---|---|---|
| Heuristic: length, keyword sets, code blocks, attached files | `src/classifier/heuristic.ts` | ✅ |
| Triage: cheap free LLM, parses `<score>1-10</score>` | `src/classifier/triage.ts` | ✅ |
| Hybrid orchestrator: heuristic, optional triage when ambiguous | `src/classifier/index.ts` | ✅ |
| Cross-platform file-path regex (POSIX + Windows separators) | `src/classifier/heuristic.ts` | ✅ |

**Acceptance**: Unit tests for every branch. Triage error/timeout paths exercised. 100% line coverage on classifier files.

---

## Phase 4 — Policy engine ✅

**Goal**: Decide which model to call from `(goal, complexity, sticky-floor, override, registry)`.

| Step | File | Done |
|---|---|---|
| Goal × complexity matrix (cost / balance / quality / custom) | `src/policy/index.ts` | ✅ |
| Tier-ladder filtering by ctx-window need | `src/policy/index.ts` | ✅ |
| Sticky-floor support (`bumpStickyFloor` with current-effective tier) | `src/policy/index.ts` | ✅ |
| Inline override bypass | `src/policy/index.ts` | ✅ |

**Acceptance**: Each (goal × complexity × sticky × override) combination returns the expected `RouteDecision`.

---

## Phase 5 — Forwarders ✅

**Goal**: Translate OpenAI-format request to the upstream provider's API and stream/buffer the response back.

| Step | File | Done |
|---|---|---|
| OpenAI-compatible adapter (also handles OpenRouter / opencode / DeepSeek / Zhipu) | `src/forwarder/openai.ts` | ✅ |
| Anthropic adapter with system-message split + tool→user role normalization | `src/forwarder/anthropic.ts` | ✅ |
| Dispatcher: per-tier candidates, retry on 408/429/5xx, escalate to next tier | `src/forwarder/index.ts` | ✅ |
| Typed `ForwardError` with retriable flag | `src/forwarder/types.ts` | ✅ |

**Acceptance**: Mock-server tests cover translation, auth header (api-key / oauth bearer), retriable failure, all-fail escalation.

---

## Phase 6 — Local proxy server ✅

**Goal**: OpenAI-compat HTTP server that classifies → routes → forwards → streams back.

| Step | File | Done |
|---|---|---|
| Bun/Node-compat HTTP server (`node:http`) with port-collision fallback (port 0 = OS-assign) | `src/proxy/server.ts` | ✅ |
| `/v1/chat/completions`, `/v1/models`, `/health` routes | `src/proxy/server.ts` | ✅ |
| Request parser: inline @model override, `/upgrade` / `/auto off|on` / `/router reset` signals | `src/proxy/parse.ts` | ✅ |
| SSE line splitter + delta + usage extractor | `src/proxy/sse.ts` | ✅ |
| Stream-through with badge prepended as first SSE chunk | `src/proxy/routes.ts` | ✅ |
| Pass-through with badge for `application/json` non-stream | `src/proxy/routes.ts` | ✅ |
| Hop-by-hop header stripping (transfer-encoding, content-length, connection, …) | `src/proxy/routes.ts` | ✅ |
| Event bus for `route` / `sticky-bump` / `ctx` / `handover` / `error` | `src/proxy/context.ts` | ✅ |

**Acceptance**: Integration tests over a real mock provider — golden path, escalation, sticky upgrade, override, ctx-window overflow, malformed JSON upstream, `/auto off`.

---

## Phase 7 — Context monitor + handover ✅

**Goal**: When a session approaches the model's context-window limit, write a structured handover doc and (optionally) auto-resume.

| Step | File | Done |
|---|---|---|
| Threshold evaluator (warn 0.70, save 0.80, emergency 0.92) | `src/handover/monitor.ts` | ✅ |
| Markdown handover generator (summary section + recent-transcript trim + emergency raw-dump fallback) | `src/handover/generator.ts` | ✅ |
| INDEX.jsonl append + scan-fallback when index missing | `src/handover/resume.ts` | ✅ |
| Path overrideable via `OPENCODE_AUTOPILOT_HANDOVER_DIR` for tests | `src/handover/generator.ts` | ✅ |

**Acceptance**: Unit tests cover save/emergency thresholds, summary LLM call, fallback dump, listHandovers index path + .md scan path.

---

## Phase 8 — Setup CLI ✅

**Goal**: One-shot interactive wizard + maintenance commands.

| Step | File | Done |
|---|---|---|
| `init` wizard (goal, tier confirm, handover prefs, privacy, badge) | `src/cli/index.ts` | ✅ |
| `status` / `tiers` / `resume` / `handovers` / `quiet` / `verbose` | `src/cli/index.ts` | ✅ |
| `init` patches `opencode.json` directly (idempotent) | `src/cli/index.ts` | ✅ |
| Interactive prompt helpers | `src/cli/prompt.ts` | ✅ |
| Reads recent-models state from `~/.local/state/opencode/model.json` | `src/cli/index.ts` | ✅ |

**Acceptance**: Manual smoke — `opencode-autopilot --help` lists every subcommand, `init` runs to completion, `status` shows correct goal + tier counts.

---

## Phase 9 — Plugin integration ✅ (loader contract still being verified live)

**Goal**: opencode plugin entry that spawns the proxy and patches opencode's runtime config.

| Step | File | Done |
|---|---|---|
| Plugin function returning `Hooks`, top-level try/catch returns empty hooks on init failure | `src/index.ts` | ✅ |
| `config` hook injects `provider.openauto` (npm: @ai-sdk/openai-compatible, baseURL → local proxy) | `src/index.ts` | ✅ |
| `chat.message` hook handles `/router resume` to inject prior handover | `src/index.ts` | ✅ |
| Module exports both `default plugin` AND `server: Plugin` AND `id` to satisfy `PluginModule` shape | `src/index.ts` | ✅ |
| `server` export added to satisfy opencode `PluginModule` contract | `src/index.ts` | ✅ |
| Module-import + plugin-function-call diagnostic traces written eagerly to autopilot.log | `src/index.ts` | ✅ |

**Acceptance**: After install, opencode startup writes a fresh `module imported` line to autopilot.log within 5 s.

---

## Phase 10 — Tests ✅

**Goal**: Unit + integration coverage of every code path with line + function coverage targets met.

| Step | File | Done |
|---|---|---|
| Unit tests across 18 files | `tests/unit/*.test.ts` | ✅ |
| Integration tests (proxy lifecycle, edges, server-edges, server-error-handler, malformed-JSON upstream, 204 no-content) | `tests/integration/*.test.ts` | ✅ |
| Cross-platform tests (Windows mock for paths) | `tests/unit/paths-windows.test.ts` | ✅ |
| Manual QA checklist | `tests/manual.md` | ✅ |

**Result**: 216 tests passing, 99.47 % line coverage, 100 % function coverage.

---

## Phase 11 — Distribution ✅

**Goal**: One-command install where everything (deps, config, plugin registration) is set up.

| Step | File | Done |
|---|---|---|
| `prepare` script — auto-builds `dist/` on git install | `package.json` | ✅ |
| `prepublishOnly` — runs build + tests before npm publish | `package.json` | ✅ |
| `postinstall` — writes autopilot.json defaults, patches opencode.json, classifies tiers from auth + opencode.json + recent-models state | `scripts/postinstall.cjs` | ✅ |
| Postinstall guards: skip on `CI=true`, `OPENCODE_AUTOPILOT_SKIP_POSTINSTALL=1`, or when running in package's own dev tree | `scripts/postinstall.cjs` | ✅ |
| `@ai-sdk/openai-compatible` declared as runtime dependency | `package.json` | ✅ |
| Plugin entry written as git specifier so opencode's package cache resolves it (bare names are silently ignored) | `scripts/postinstall.cjs`, `src/cli/index.ts` | ✅ |
| README install instructions reflect actual command path | `README.md` | ✅ |

**Acceptance**: `cd ~/.config/opencode && npm install github:yagneshempyreal-dotcom/opencode-autopilot` — postinstall logs success, opencode.json contains `"opencode-autopilot@git+..."` plus `provider.openauto`, autopilot.json exists with detected tiers.

---

## Phase 12 — Live verification ⏳

**Goal**: Confirm end-to-end on a real opencode install that `openauto/auto` actually routes prompts through the proxy.

| Step | Status |
|---|---|
| `module imported` and `plugin function called` lines appear in `~/.local/share/opencode/autopilot.log` within 5 s of opencode startup | ⏳ pending user-side verification |
| `curl http://127.0.0.1:4317/health` returns `{"ok":true,...}` after opencode start | ⏳ |
| Picking `openauto/auto` and sending a trivial prompt produces a response with the `[router → free / <model>]` badge prefix | ⏳ |
| Sticky upgrade: sending "this is wrong, try again" promotes the next prompt to a higher tier (badge shows `↑ upgraded`) | ⏳ |
| Inline `@anthropic/claude-haiku-4-5` override forces that one model (badge shows `manual`) | ⏳ |

**On hold pending**: user re-running install after commit `529e1aa` and confirming opencode loads the plugin via the new git-specifier path.

If `module imported` still doesn't appear after the git-specifier fix:

1. Check `~/.cache/opencode/packages/` — is there a directory matching `opencode-autopilot@git+...`?
2. Run `opencode --debug` (if such a flag exists) or `LOG_LEVEL=trace opencode` and grep its log for `opencode-autopilot`.
3. Compare with how superpowers loads (`~/.cache/opencode/packages/superpowers@git+.../...`) — match the exact directory layout, including `.opencode/plugins/<name>.js` entry-point convention if opencode requires it.

---

## Phase 13 — Polish & release (post-verification) 📋

| Step | Status |
|---|---|
| Cost/usage telemetry CLI summary (`opencode-autopilot stats`) | not started |
| Per-project goal override (`.opencode/autopilot.json` overrides global) | not started |
| Auto-resume on opencode startup (read most-recent handover) | hook present, runtime behavior not validated |
| Streaming handover (rolling summary while generating) | not started |
| Publish to npm registry (`opencode-autopilot` name) so users can `npm install opencode-autopilot` directly | not started |
| Demo screencast / docs site | not started |

---

## Lessons learned (debugging notes)

These are notes from the live integration that future maintainers will want.

1. **opencode 1.14 plugin loader** does not resolve bare names from `~/.config/opencode/node_modules`. It uses its own package cache keyed by version specifier. **Always use a git URL or version-pinned spec** in `opencode.json`'s `plugin` array.

2. **opencode plugin module contract** — plugin module must export either `default: Plugin` or `server: Plugin`. We export both for safety. Also `id?: string` for identification.

3. **`type: "module"` packages** — postinstall script must be `.cjs` if using `require`, or use ES-module syntax. We chose `.cjs` to keep it dependency-free at install time.

4. **`prepare` script** is required for git installs because `dist/` is gitignored. Without it, `npm install <git-url>` produces a package whose `bin` points at a missing file.

5. **Hop-by-hop headers** must be stripped when proxying. Forwarding `transfer-encoding: chunked` from upstream while we re-frame the body causes Node's HTTP parser to choke on the next request on the same connection — manifests as "Parse Error: Expected HTTP/, RTSP/ or ICE/".

6. **macOS port reuse** — undici (Node fetch) hits `EADDRNOTAVAIL` on rapid sequential localhost requests. Tests use `node:http` directly with `agent: false, connection: close` to avoid the issue. Production runtime does not hit this because it's not making rapid sequential calls to the same local port.

7. **Auto-classify model registry** — many users don't declare models inline in `opencode.json` (opencode discovers via the provider SDK at runtime). buildRegistry must seed from three sources to match what the user actually sees in opencode: inline declarations, `~/.local/state/opencode/model.json`, and the user's own autopilot.json tier list.
