# LLMFIT Advisor

Bounded read-only advisory adapter over the pinned `llmfit` model-fit engine.

llmfit is a **calculation source only**. This plugin asks it which models fit
this machine; it does not give llmfit any authority over installation, routing,
GPU allocation, reservation, or execution.

## What it exposes

Exactly one model-facing tool:

### `llmfit_recommend(use_case, limit)`

| Argument | Type | Contract |
| --- | --- | --- |
| `use_case` | string, required | One of `general`, `coding`, `reasoning`, `chat`, `multimodal`, `embedding`. Anything else is refused before any process starts. |
| `limit` | integer, optional (default 5) | `1`–`10` inclusive. Non-integers and out-of-range values are refused before any process starts. |

The tool runs exactly this argv, with only the two validated values varying:

```
/home/liongateos/.local/share/liongateos/third-party/llmfit/v1.1.20/llmfit
--no-dashboard
recommend
--json
--use-case <validated use_case>
--limit <1..10>
```

## Why the surface is this small

The prior read-only discovery established four constraints that shape this
plugin. Each one rules out a larger integration:

1. **MCP is rejected.** DeepSeek Harness has a verified stdio MCP client, but
   every tool a server advertises becomes model-visible: the bridge registers
   all of them unconditionally and there is no per-tool allowlist in
   `packages/mcp/mcp-client`. Exposing llmfit over MCP would therefore publish
   `search_models` (which falls back to live Hugging Face access) alongside the
   read-only advisory tools. A bounded CLI adapter keeps the allowlist at
   exactly one tool, enforced in code rather than in configuration.
2. **`memory_available_gb` is not capacity.** llmfit multiplies its `--memory`
   override by every GPU it detects, so on this host (two RTX 3090s) a 24 GB
   override reports 48 GB. The field is theoretical pooled size, never
   LionGateOS-authorized capacity. This adapter **removes it** from every
   record. `--memory` is deliberately not passed.
3. **`fit_level` is not permission.** A `perfect` fit describes arithmetic on
   hypothetical hardware. It does not establish that a model may be launched,
   that a GPU is free, or that a route exists. The tool result states the
   advisory boundary explicitly and never promotes a catalog model to
   "installed".
4. **llmfit cannot be the installed-model authority.** Installed truth belongs
   to Local Model Manager (`verifyInstalled`: configured path plus `stat()`),
   and provider-route identity belongs to the `llm` service. llmfit model names
   are catalog labels from its own index and are never treated as DeepSeek
   route ids.

## Commands that are unreachable

`search`, `hf-search`, `update`, `download`, `run`, `bench`, `serve`, and
`cluster` cannot be produced by this plugin. No code path constructs them, and
a guard denies any `llmfit*` tool name other than `llmfit_recommend`. In
particular the happy path performs no network access: `recommend --json` reads
llmfit's bundled catalog.

## Failure contract

Every failure is a typed result; no raw exception reaches the agent surface.

| `status` | Cause |
| --- | --- |
| `invalid_arguments` | `use_case` off the allowlist, or `limit` not an integer in `1..10`. Nothing spawned. |
| `unavailable` | The pinned binary is missing or not executable. Nothing spawned. |
| `timeout` | No outcome within `timeoutMs` (default 20 000); the process is terminated. |
| `failed` | Spawn failure, non-zero exit, signal-killed process, malformed JSON, or a document without a `models` array. |
| `output_too_large` | stdout exceeded the 2 MiB cap. No partial advisory is returned. |

## Safety properties

- **argv only.** Execution goes through `ctx.subprocess.spawn`, whose argv is
  never shell-interpreted. The plugin imports no `node:child_process`.
- **Scrubbed environment.** The subprocess seam drops credential-shaped
  (`/KEY|PASSWORD|SECRET|TOKEN/i`) and `DSH_*` ambient names before the child
  starts. The adapter adds no environment entries.
- **Bounded streams.** stdout is capped at 2 MiB in memory, stderr at 8 KiB, and
  the termination grace period is 2 000 ms.
- **Monotonic guard.** `ctx.tools.guard` runs after the `tools/pre-execute`
  waterfall, so a later policy cannot turn the namespace denial into
  permission.
- **Fixed binary.** The path is a constant; `PATH` is never consulted, and the
  binary is checked for `X_OK` on every call rather than cached.

## Configuration

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `cwd` | string | process directory | Child working directory. `recommend` reads no repository path. |
| `timeoutMs` | number | `20000` | Per-call deadline. |

## Layout

```
index.js            plugin entry: one tool, one guard
core/advisor.js     argv construction, bounded spawn, typed results, projection
cordis.patch.yml    loader patch row
tests/              unit tests over a fake spawn; no model, GPU, or network
```

## Verification

```sh
node --test owner/llmfit-advisor/tests/llmfit-advisor.test.js
```

The suite covers fixed argv, the closed argument surface, injection attempts
(subcommand, argv, and shell metacharacters), binary availability, timeout,
non-zero exit, signal death, malformed JSON, schema mismatch, output overflow,
`memory_available_gb` removal, `memory_required_gb` retention, the advisory
annotation, and the namespace guard. No test starts llmfit or touches a GPU.
