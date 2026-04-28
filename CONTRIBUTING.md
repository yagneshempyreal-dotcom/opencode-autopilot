# Contributing to opencode-openauto

Thanks for wanting to improve the router. `main` is locked; all changes land via pull request.

## TL;DR

```bash
gh repo fork yagneshempyreal-dotcom/opencode-autopilot --clone
cd opencode-autopilot
git checkout -b feat/<short-name>
# code, then:
npm test
git push origin feat/<short-name>
gh pr create --base main --title "feat: ..." --body "..."
```

## Branch protection rules on `main`

- Direct push: blocked. Only PR merges.
- Force push: blocked.
- Branch deletion: blocked.
- Conversation resolution required before merge.
- Admin override: not enforced (the repo owner can self-merge to keep velocity).

You don't need write access to the upstream — fork and submit a PR.

## What we look for in a PR

1. **Tests for new behavior.** Add or extend a file under `tests/unit/` (or `tests/integration/`). The suite must stay green:
   ```bash
   npm test
   ```
2. **No regressions in dist.** Built artifacts under `dist/` are tracked because opencode installs the plugin via `git+https://`. After source changes, run:
   ```bash
   npx tsc
   git add dist/
   ```
3. **Conventional commits.**
   - `feat:` — new behavior
   - `fix:` — bugfix
   - `docs:` — README / CONTRIBUTING / inline doc
   - `refactor:` — no behavior change
   - `chore:` — build, deps, scripts
   - `test:` — only test changes
4. **Small focused PRs.** One concern per PR. Cleanup commits go in their own PR.
5. **Don't commit secrets.** API keys live in `~/.local/share/opencode/auth.json`; `.gitignore` excludes the obvious paths but always re-check `git diff --cached`.

## Local dev loop

```bash
git clone https://github.com/<your-fork>/opencode-autopilot.git
cd opencode-autopilot
npm install                # devDeps only — no runtime deps
npm test                   # vitest, ~1.5 s
npm run typecheck          # tsc --noEmit
npx tsc                    # build dist/
./scripts/refresh.sh --yes # clear opencode plugin cache so changes pick up
opencode                   # try it out in the TUI
```

If you change runtime code that opencode loads (`src/index.ts`, `src/proxy/**`), you must `npx tsc` and commit `dist/` for opencode to see the change after a `refresh.sh`.

## File map

```
src/
├── index.ts             plugin entry; opencode hooks (config, chat.message)
├── proxy/
│   ├── server.ts        HTTP listener
│   ├── routes.ts        /v1/chat/completions handler + slash commands
│   ├── parse.ts         router/auto/upgrade prefix detection
│   ├── sse.ts           SSE streaming utilities
│   └── context.ts       ProxyContext + event bus
├── classifier/
│   ├── heuristic.ts     prompt-complexity heuristic
│   ├── triage.ts        free-LLM triage for ambiguous prompts
│   ├── tags.ts          task-tag extraction (code, math, vision, …)
│   └── index.ts         classify() entry
├── policy/index.ts      goal matrix, sticky floor, candidate ranking
├── forwarder/
│   ├── index.ts         dispatch + fallback + health updates
│   ├── openai.ts        OpenAI-compat forwarder
│   ├── anthropic.ts     Anthropic Messages forwarder
│   └── types.ts         ForwardError, retriable status helper
├── registry/
│   ├── index.ts         buildRegistry from auth + opencode.json + recent
│   ├── classify.ts      tier + tag inference from model name
│   └── health.ts        per-model health store, probeModel, verifyAll
├── config/
│   ├── store.ts         autopilot.json read/write
│   ├── auth.ts          opencode auth.json read
│   └── opencode.ts      opencode.json read + ensureRouterProvider
├── session/state.ts     per-session sticky-floor state
├── handover/            handover doc generation + resume
├── badge/format.ts      per-turn badge string
├── cli/                 opencode-openauto CLI (init, status, refresh, setup, ...)
└── util/                logging, paths, token estimation

scripts/
├── setup.sh / setup.cmd       register plugin + provider in opencode.json
└── refresh.sh / refresh.cmd   kill opencode + clear caches + restart prompt

tests/
├── unit/                28 files, fast, hermetic
└── integration/         a few HTTP-server tests
```

## Adding a new router command

Example: add `router debug`.

1. **Parse**: extend `ParsedSignals` in `src/proxy/parse.ts`. Add a regex like `SLASH_DEBUG_RE` and set `signals.debugRequested = true` when matched. Add unit tests in `tests/unit/parse.test.ts`.
2. **Handle**: in `src/proxy/routes.ts`, branch on the new signal before classification and call `respondInline(res, ...)` with whatever text/JSON you want returned.
3. **Document**: update the command table in `README.md`.
4. **Help text**: the status / refresh CLIs mention every command — add yours there too.

## Adding a new forwarder

Use case: a provider with a non-OpenAI, non-Anthropic API shape.

1. Create `src/forwarder/yourprovider.ts` exporting a `Forwarder` (signature in `src/forwarder/types.ts`).
2. Register it in `FORWARDERS` map at the top of `src/forwarder/index.ts`.
3. If the provider needs a new `apiShape` literal, extend the union in `src/types.ts` (`ModelEntry["apiShape"]`) and the inference rule in `src/registry/classify.ts` (`inferApiShape`).
4. Add a small integration test under `tests/integration/`.

## Adding a new classifier signal

The heuristic in `src/classifier/heuristic.ts` is intentionally simple. Tag-based ranking lives in `src/classifier/tags.ts`. Don't add ML; use cheap regexes / counts. If you need more nuance, the right hook is `src/classifier/triage.ts` which calls a free LLM.

## Reporting bugs

- Re-run with `~/.local/share/opencode/autopilot.log` open.
- Capture: opencode version, plugin git SHA (`git -C ~/.cache/opencode/packages/opencode-openauto* rev-parse HEAD` or just the latest git log on this repo), `router status` output, the failing prompt.
- Open an issue with that bundle.

## Releasing

The project ships from `main` via `git+https`. There is no npm publish step. Every merge to main is a release. Tag releases with `vX.Y.Z` matching `package.json`'s `version` for clarity:

```bash
# after merging a feature batch
gh release create v0.2.0 --notes "..."
```

## Questions

Open a discussion or DM the owner. Be concrete; paste logs.
