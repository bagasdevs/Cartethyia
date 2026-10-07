# Cartethyia Agent Guide

The goal is to leave the repository trustworthy for the next reader. Keep this
file concise; detailed subsystem guidance lives in
`.agent/skills/cartethyia-engineering/`.

## Core rule

Every reported issue must be **reproduced or explicitly flagged as unverified**.
Every feature and bug fix must be implemented with the proper logic and handlers
across the affected code path. Do not ship a workaround disguised as a fix.

No overengineering unless the task explicitly asks for it. Prefer the smallest
complete change that fixes the owning layer, migrates its callers, and proves the
acceptance criteria.

## Working agreement

- Keep related implementation, documentation, and test changes together as one
  coherent change set. Complete the relevant work, run the appropriate gates,
  and create one reviewable commit for the finished change.
- Do not push automatically. Push only when the user explicitly asks for it.
- Use `bun install` for dependency installation. Use the unified `bun setup`
  command for environment creation, encryption-key generation, Lite/Full
  selection, database checks, and optional Redis checks. Use
  `bun setup --non-interactive` for automation.
- `.env.example` defaults to `CARTETHYIA_DB_MODE=lite`; Docker Compose defaults
  to Full with external PostgreSQL and bundled Redis configuration. Keep these
  defaults intentional and document changes in `documentation/getting-started.md`.
- Lite uses embedded PGlite and in-process coordination when `REDIS_URL` is
  absent. Full uses external PostgreSQL; Redis remains optional unless shared
  coordination is required. Do not reintroduce `REDIS_MODE` or
  `single_instance_local`.

## Start here

1. State the goal, acceptance criteria, and hard constraints in one sentence.
2. Use GitNexus first for blast search: owner, callers, implementations, and
   dynamic paths. Prefer the MCP tools (`impact`, `query`, `context`); without
   MCP, use `node .gitnexus/run.cjs impact "symbol" --direction upstream --repo .`.
3. If GitNexus is unavailable or stale, run `node .gitnexus/run.cjs analyze
   --index-only`, or use the available search tools (`Read`, `Grep`, `Glob`, or
   a targeted command) and obtain the same context manually.
4. Load the `cartethyia-engineering` skill and read the matching reference under
   `.agent/skills/cartethyia-engineering/references/` before subsystem work.
5. Inspect the target, callers, contracts, config, and docs before editing.
6. When a browser/CDP runtime is available, use it headlessly for dashboard/UI
   verification; do not replace measurable browser evidence with markup guesses.

Do not spend a turn only restating a plan. The first useful action should read,
search, reproduce, edit, or verify something.

## Implementation loop

1. Reproduce the issue or record the exact blocker and mark it unverified.
2. Identify the canonical owner and state the causal mechanism.
3. Check blast radius before changing shared status, mappings, contracts, schemas,
   routing, retries, cooldowns, security, or wire formats.
4. Fix the root cause in the owner and update every affected caller/handler.
5. Remove obsolete paths; do not add aliases, shims, special cases, or silent
   fallbacks to preserve broken behavior.
6. Update active docs, config, and generated sources through their generators.
7. Re-run the same reproduction, then run the narrowest useful gates.
8. Report evidence, failures, skipped checks, and unavailable surfaces honestly.

A temporary script is acceptable only when it exercises the real production path,
proves the behavior, and is deleted afterward. A workaround is acceptable only
when explicitly requested or when it is a named temporary boundary with a clear
removal condition.

## Repository boundaries

- `src/` is the production backend; `dashboard/src/` is browser code.
- Dashboard code must not import Elysia, database drivers, filesystem modules,
  secrets, or Node-only runtime dependencies.
- Treat network responses, environment variables, database rows, request bodies,
  and user values as untrusted. Validate at boundaries and fail closed.
- Preserve intentional provider wire bytes, headers, and user-agent behavior.
- Keep one source of truth for provider metadata, persisted contracts, environment
  names, routing policy, and dashboard mirrors.
- Development is local-first: use an available local PostgreSQL (including Laragon
  on Windows) and local Redis/in-memory mode before considering Docker. Docker is
  an optional deployment/test fallback, never a default development prerequisite.
- Keep scripts flat with `ops-`, `build-`, or `ci-` prefixes. Avoid barrel files;
  use role names such as `contracts.ts`, `routes.ts`, `store.ts`, `service.ts`,
  and `errors.ts`.
- Do not hand-edit generated output. Change its source or generator.
- Use strict TypeScript conventions already configured by the repository: no `any`,
  suppressions, needless assertions, or weakened compiler settings.

## Clean cutover

For a rename, move, replacement, feature removal, or contract change:

1. Search runtime code, scripts, dashboard, config, and docs.
2. Change the canonical definition and migrate all callers.
3. Delete the obsolete symbol/path; do not leave a compatibility alias.
4. Search the old name again and typecheck the affected surface.
5. Prove deadness before deleting code; declaration-only search is not proof.

## Verification gates

```bash
bun run typecheck
bun run dashboard:typecheck  # when dashboard/ changes
bun run build                # when entry points or build contracts change
bun run test:backend         # or bun run test / dashboard:test / test:watch
```

The repository carries an active test suite (`test/`, `dashboard/test/`, run via
`scripts/ci-run-tests.ts` against the isolated `.env.test` database). Typecheck
is not behavioral proof. Exercise the real boundary: a live gateway request,
headless browser/CDP surface when available, database migration in an isolated
environment, or a temporary script calling production code. If a browser/CDP
runtime is available, UI claims require that automation evidence; if unavailable,
say exactly why.

## Safety and git

Never use destructive git commands such as `reset --hard`, `checkout --`, or
`clean`. Do not commit, push, deploy, touch production data, delete user data, or
discard unrelated working-tree changes unless explicitly asked. Never expose
credentials, tokens, keys, or sensitive payloads in output. Verify the environment
before database/production operations and prefer reversible, transactional steps.

## Completion report

Report:

- what changed and where;
- the reproduction or why it remains unverified;
- commands/gates run and their result;
- real-boundary evidence;
- failures, skips, blockers, and next action.

Do not claim an issue is fixed when it was only masked, or claim tests passed when
no tests were run.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Cartethyia** (22347 symbols, 57193 relationships, 662 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/Cartethyia/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Cartethyia/clusters` | All functional areas |
| `gitnexus://repo/Cartethyia/processes` | All execution flows |
| `gitnexus://repo/Cartethyia/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
