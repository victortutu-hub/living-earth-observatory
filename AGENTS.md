# Repository contract

## Project identity

Luminomorphism is a scientific visualization / generative science-art platform,
not a generic Three.js demo. Living Earth and Living Protein are observatory
modules within a broader observatory platform. Extend existing abstractions
before introducing parallel architectures. Repository code and executable
evidence take precedence over aspirational roadmaps or stale documentation.

## Scientific representation

Never silently conflate `observed`, `reconstructed`, `physical-model`,
`simulation`, `prediction`, `interpretive`, and `fallback`.
A visual must not claim observed/live status without traceable provenance.
Fallback data and procedural substitutes must remain explicitly identifiable;
procedural interpretation must not be presented as observation.

## Forward architecture invariants

These are governance rules for future work, not claims that all current code
already complies. Known violations are recorded in `docs/architecture-baseline.md`.

- `DESTROYED_IS_TERMINAL`: asynchronous completion cannot resurrect a module.
- `NO_UNOWNED_ASYNC_RESOURCES`: requests, timers, listeners, GPU resources and
  pending initialization must have an owner and a cancellation/disposal policy.
- `NO_NEW_DATA_PATH_WITHOUT_PROVENANCE`.
- `NO_PARALLEL_ARCHITECTURE_WHEN_AN_EXISTING_ABSTRACTION_APPLIES`.
- `NO_DIRECT_FETCH_WHEN_THE_SHARED_REQUEST_RUNTIME_IS_THE_CORRECT_EXISTING_ABSTRACTION`,
  unless an explicit architectural exception is documented. Not every fetch is
  a feed: document asset, service-worker and conversion-job exceptions as needed.
- `NO_VISUAL_CHANGE_DURING_INFRASTRUCTURE_TASKS`.
- `NO_REFACTOR_FOR_CLEANLINESS_DURING_UNRELATED_TASKS`.
- `NO_BUNDLER_OR_MODULE-SYSTEM_MIGRATION_DURING_BEHAVIOR_FIXES`.
- `NO_COMPLETION_WITHOUT_EXECUTABLE_EVIDENCE`: report untested gates honestly.

Keep event providers in the existing feed abstraction where applicable; the
visual layer registry and the global source registry serve different purposes.
Shared implementation does not imply a shared runtime instance across iframes.
Preserve mixed module semantics: frontend `.js` uses ESM, while the proxy uses
CommonJS. A package-wide module migration needs its own explicitly scoped task.

## Repository areas

| Area | Responsibility |
| --- | --- |
| `src/core/` | Broker, request/cache runtime, status, diagnostics, module host/context |
| `src/config/` | Observatory, source, capability and taxonomy definitions |
| `src/atlas/` | Platform navigation, inspectors and module coordination |
| `src/control-center/` | Runtime controls, diagnostic snapshot/replay UI |
| `src/earth/` | Living Earth rendering, providers and observatory lifecycle |
| `src/protein/` | Living Protein data, geometry and observatory lifecycle |
| `src/gateway/` | WebGL previews, adapters, prefetch and preview quality |
| `tests/` | Versioned automated tests and fixtures |
| `tools/` | Repository checks and explicitly invoked asset tooling |
| `nasa-proxy-server.js` | Node proxy and local H.264 conversion service |
| `sw.js` | Browser service-worker cache policies |

## Protected / normally ignored areas

Do not inspect or modify these unless the task explicitly requires it:
`node_modules/`, `releases/`, `exports/`, `proxy-cache/`, `tmp/`, `Back Up/`,
`.codex-analysis/`, `.codex-validation/`.
Running approved package commands may use installed dependencies; this is not
permission to explore or edit dependency code. Do not regenerate binary assets
during unrelated work. Keep secrets out of reports and commits.

## Before implementation

1. Inspect `git status` and staged state.
2. Identify and preserve pre-existing user modifications; do not revert, stage,
   overwrite or normalize them as a side effect.
3. Inspect the existing abstraction relevant to the task.
4. Identify intended files.
5. State invariants at risk.
6. State the validation plan.

## After implementation

Report changed files, exact verification commands and results, residual risks,
whether visual behavior was touched, final `git status`, staged state, and
whether any pre-existing user change was modified.
Use `npm run verify:f0` for the foundation gate and appropriate additional
task-specific evidence. Do not claim browser, performance or security validation
from syntax/unit checks alone. Do not commit unless explicitly requested.
