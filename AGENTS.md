# AGENTS.md: Flinch

> Instructions for AI coding agents working in this repo. Read fully before making changes.
> (Using Claude Code? Save or symlink this file as `CLAUDE.md` too.)

## 1. What we are building

**Flinch** is a native desktop "Cursor for Blender". The user describes a 3D or 2D (Grease Pencil) animation in chat, an LLM writes a Blender Python (`bpy`) script, and Flinch **actually executes it in headless Blender, validates the result, and feeds errors back to the LLM until it works** (or the retry budget runs out).

The headline deliverable is **proof**: a reproducible eval of **30 prompts**, reporting:
- **pass@1**: success with no error feedback
- **pass@3**: success using the execute -> feedback -> retry loop (max 3 attempts)

The gap between the two is the evidence that execution feedback works. **Never fake, cherry-pick, or weaken evals to improve numbers.**

**Cost rule:** Flinch must be fully usable at **zero cost**. No paid, vendor-locked SDKs. LLM access goes through any **OpenAI-compatible chat API** (local Ollama by default; free tiers of OpenRouter, Groq, or Google AI Studio also work).

## 2. Tech stack (decided; do not swap without asking)

| Layer | Choice |
|---|---|
| **Backend** | **Rust** (workspace of crates). All logic lives here: agent loop, LLM client, Blender runner, storage |
| Desktop shell | **Tauri 2** (thin: exposes `flinch-core` to the UI via commands and events) |
| Frontend | React + TypeScript (strict) + Vite |
| UI | Tailwind CSS + shadcn/ui, Zustand for state, Monaco editor (with diff view) |
| Frontend package manager | **Bun** (never npm, yarn, or pnpm) |
| Rust async / HTTP | `tokio`, `reqwest` (streaming), manual SSE parsing |
| LLM access | One `LlmProvider` trait with an **OpenAI-compatible** implementation (`/v1/chat/completions`, streaming). **No vendor SDKs** |
| In-Blender harness | Python 3 (`bpy`), single file `blender/harness.py` |
| Storage | SQLite via `rusqlite` (bundled) |
| TS <-> Rust types | Generated bindings (`tauri-specta` or `ts-rs`); never hand-write duplicate types |
| CLI | `clap`; the `flinch` binary runs evals, doctor checks, and the harness headlessly |
| Tests | `cargo test`, `bun test`, `pytest` (pure-Python helpers only) |

**Pinned Blender version:** `blender/VERSION` (default: latest **LTS**, currently 4.5 LTS; verify before pinning). The `bpy` API changes between versions, especially **Grease Pencil (v3 API in 4.3+)**. The pinned version goes in the LLM system prompt and in every eval report.

### Why Rust owns the agent loop
Evals and the desktop app call the **exact same Rust code** (`flinch-core`). There is no second implementation to drift, so the eval measures the real product. The UI is only a view layer.

## 3. Repo layout

```
flinch/
  README.md
  AGENTS.md
  Cargo.toml                    # Rust workspace root
  rust-toolchain.toml           # pinned Rust version
  package.json                  # Bun workspace (frontend only) + task scripts
  bunfig.toml
  flinch.example.toml           # provider/model/Blender config template
  .env.example

  crates/
    flinch-core/                # ALL backend logic (no Tauri dependency)
      src/
        agent/                  # loop, prompt assembly, code extraction, feedback builder
        provider/               # LlmProvider trait + openai_compat.rs (SSE streaming, backoff)
        runner/                 # spawn Blender, timeout, process-tree kill, temp dirs
        harness/                # Rust types for harness result JSON (schema v1)
        store/                  # SQLite: sessions, attempts, eval runs
        config.rs  error.rs  lib.rs
    flinch-cli/                 # `flinch` binary: eval, harness, doctor, run
      src/main.rs  eval/

  apps/
    desktop/
      src-tauri/                # thin Tauri 2 shell: commands + events over flinch-core
      ui/                       # React app
        src/{components,features,state,lib,bindings}/

  blender/
    VERSION                     # pinned Blender version
    harness.py                  # THE single execute+validate entrypoint
    checks.py                   # declarative assertion engine
    tests/                      # known-good / known-bad sample scripts

  prompts/                      # LLM prompts as plain files (loaded at runtime, not compiled in)
    system.md
    feedback.md
    examples/                   # working bpy examples (incl. Grease Pencil v3)

  evals/
    prompts.json                # the 30 prompts + checks
    results/                    # run outputs (gitignored; summaries committed to docs)

  docs/
    ARCHITECTURE.md
    EVALS.md                    # methodology + latest results table
    PROVIDERS.md                # setup for Ollama / OpenRouter / Groq / Google AI Studio

  scripts/                      # setup + check helpers
```

## 4. Commands

```bash
bun install                      # frontend deps
bun run dev                      # tauri dev (desktop app)
bun run build                    # tauri build
bun run check                    # fmt + clippy + cargo test + typecheck + lint + bun test (run before finishing)

cargo run -p flinch-cli -- doctor                         # verify Blender path/version + provider reachable
cargo run -p flinch-cli -- harness path/to/script.py      # run one script through the harness
cargo run -p flinch-cli -- run "a red cube bouncing"      # one prompt through the full loop
bun run eval                                              # full 30-prompt eval (alias of: flinch eval)
bun run eval -- --tier easy
bun run eval -- --id med-04
bun run eval -- --provider ollama --model <name>
```

Configuration (`flinch.toml`, template in `flinch.example.toml`):
```toml
[blender]
bin = "/path/to/blender"           # required; doctor fails loudly if missing or wrong version

[provider]
kind = "openai_compatible"
base_url = "http://localhost:11434/v1"   # Ollama default; swap for OpenRouter/Groq/Google endpoints
model = "<coding model name>"
api_key_env = ""                         # name of env var holding a key; empty for local
max_concurrency = 1                      # keep low on free tiers
```
API keys come from env vars (CLI) or the OS keychain (`keyring` crate, desktop app). **Never** write keys to `flinch.toml`, logs, or the DB.

## 5. Architecture rules

### 5.1 One harness
`blender/harness.py` is the **only** place LLM-generated scripts execute. Invocation:
```
blender -b --factory-startup --python-exit-code 1 --python blender/harness.py -- \
  --script <generated.py> --out <result.json> [--spec <checks.json>] [--render-test]
```

The harness must:
1. `ast.parse` the script first (syntax errors with line/col).
2. `exec` it in try/except, capturing full traceback, stdout, stderr.
3. Collect scene stats.
4. If `--spec` is given, run declarative checks from `checks.py`.
5. If `--render-test`: render **one low-res frame** with Workbench (EEVEE can fail headless without a GPU).
6. **Always** write the result JSON, even on crash (top-level try/finally).

Result JSON (stable; bump `schema` on any change; mirror as Rust types in `flinch-core/harness`):
```json
{
  "schema": 1,
  "ok": false,
  "stage": "syntax | runtime | validation | render | timeout | ok",
  "error": { "type": "AttributeError", "message": "...", "traceback": "...", "line": 12 },
  "stdout": "...",
  "warnings": ["..."],
  "scene_stats": {
    "blender_version": "4.5.x",
    "objects": [{ "name": "Cube", "type": "MESH", "has_animation": true }],
    "counts": { "mesh": 1, "light": 1, "camera": 1, "grease_pencil": 0 },
    "frame_range": [1, 120],
    "fps": 24,
    "keyframe_count": 8
  },
  "checks": [{ "id": "has_keyframed_mesh", "passed": true, "detail": "" }],
  "duration_ms": 1830
}
```

### 5.2 Provider layer (free and vendor-neutral)
- `trait LlmProvider { async fn stream_chat(&self, req: ChatRequest) -> Result<impl Stream<Item = Chunk>> }`.
- One implementation: **OpenAI-compatible** over `reqwest` with manual SSE parsing. Ollama, OpenRouter, Groq, Google AI Studio (OpenAI-compat endpoint), and LM Studio are all just different `base_url` + `model`.
- Must handle: streaming, cancellation, **429 and 5xx retry with exponential backoff + jitter**, request timeouts, and clear errors for unreachable servers or unknown models.
- Do not depend on provider-specific features (native tool calling, JSON mode). Use plain chat + a fenced `python` block for code, so any model works.
- Free tiers have rate limits and change often; do not hardcode limits or model names in logic.

### 5.3 Agent loop (`flinch-core/agent`)
```
generate script -> runner.run -> ok? done
                              -> else feed back {stage, error, traceback, scene_stats, stdout tail}
                                 -> model returns the FULL corrected script -> repeat
max attempts: 3 (configurable). Record every attempt (prompt, raw response, script, harness result).
```
Rules:
- Model returns the **complete script** in a single fenced `python` block each attempt. Extract strictly; a missing block counts as a failed attempt with a clear error. Small local models often add prose or multiple blocks, so handle this robustly.
- Feedback includes the traceback and the failing script, truncated by keeping head and tail. **Never drop the error line.** Respect small context windows of local models (configurable token budget).
- System prompt (`prompts/system.md`) states: pinned Blender version, `bpy` only, start from a clean scene, prefer `bpy.data` over `bpy.ops`, no network or subprocess, no files outside the working dir.
- Prompts are **files** under `prompts/`, loaded at runtime so they can be iterated without recompiling. Eval reports record a hash of the prompt files.
- Stream tokens to the UI; never block the UI thread on a run.

### 5.4 Runner (`flinch-core/runner`)
- Spawn Blender with `tokio::process::Command`, `kill_on_drop(true)`.
- **Hard timeout** (default 60s; 180s with render). On timeout, kill the **whole process tree**: Unix via `process_group(0)` + `killpg`; Windows via a Job Object.
- Fresh **temp dir per attempt**; clean up afterwards.
- Stream stdout/stderr line-by-line through a callback (the Tauri shell turns it into `blender://log` events).
- Typed errors with `thiserror`. No `unwrap()` / `expect()` outside tests.
- Generated scripts are **untrusted code**. Isolation is best-effort: temp dir, timeout, and a static warning scan (`os.system`, `subprocess`, `socket`, `shutil.rmtree`, writes outside the temp dir). Show warnings to the user. **Never describe this as a security sandbox.**

### 5.5 Tauri shell (`apps/desktop/src-tauri`)
Thin. Commands: `run_prompt`, `cancel_run`, `check_blender`, `list_sessions`, settings get/set. Events: `agent://token`, `agent://attempt`, `blender://log`. **No business logic here**; if you are writing logic in this crate, it belongs in `flinch-core`.

## 6. Eval suite (the proof)

Location: `evals/prompts.json`. Exactly **30 prompts**:

| Tier | Count | Examples |
|---|---|---|
| easy | 10 | primitives, transforms, simple lights and camera |
| medium | 10 | materials/nodes, keyframed loc/rot/scale, modifiers |
| hard | 10 | Grease Pencil drawing + animation, drivers, particles, shape keys, constraints, multi-object choreography |

Entry format:
```json
{
  "id": "med-04",
  "tier": "medium",
  "prompt": "Create a red cube that bounces up and down 3 times over 2 seconds at 24 fps.",
  "checks": [
    { "type": "object_count", "object_type": "MESH", "min": 1 },
    { "type": "has_keyframes", "data_path": "location", "min_keyframes": 4 },
    { "type": "frame_range", "min_length": 48 }
  ]
}
```

Rules (strict):
- **Success = no error AND all checks pass.** Report "executes" and "passes checks" separately.
- Checks exist only in the spec. **Never show checks or expected answers to the model.**
- Checks are declarative, implemented in `blender/checks.py` (`object_count`, `has_keyframes`, `frame_range`, `has_material`, `has_modifier`, `has_grease_pencil_strokes`, `has_driver`, `renders_nonblank`).
- **N=3 runs per prompt** (configurable) to average LLM variance.
- Free tiers rate-limit: default concurrency 1, backoff on 429, and **resumable runs** (skip already-completed prompt/run pairs).
- Results are **per model**. Free and local models differ widely; never present one model's numbers as "the" result.
- Output: `evals/results/<timestamp>.json` (full per-attempt logs) plus a regenerated table in `docs/EVALS.md`:

```
| Model | Tier   | n  | executes@1 | pass@1 | pass@3 (feedback) |
|-------|--------|----|------------|--------|-------------------|
```
- Every report records: Blender version, model, provider, date, N, prompt-files hash, git SHA.
- If a check is wrong or too lenient, fix it, rerun **everything**, and note the change in `docs/EVALS.md`.

## 7. Build order (strict; do not start a phase until the previous one passes)

**M0: Core + harness + CLI eval, no UI.**
`harness.py`, `checks.py`, `flinch-core` (provider, runner, agent loop), `flinch-cli` (`doctor`, `harness`, `run`, `eval`), first 10 easy prompts.
*Done when:* `bun run eval -- --tier easy` runs end to end and writes results JSON + markdown table against a free provider.

**M1: Full 30 prompts + tuning.**
Add medium/hard prompts; tune `prompts/` and the feedback format (never the checks).
*Done when:* all 30 run reproducibly and `docs/EVALS.md` has a real table for at least one model.

**M2: Tauri shell.**
Scaffold with `bun create tauri-app` (React + TS), wire commands/events, generated TS bindings, log streaming.
*Done when:* the same script yields the same `HarnessResult` via the app and via `flinch harness`.

**M3: Chat + editor UI.**
Streamed chat, Monaco with diff between attempts, per-attempt error panel, retry and cancel.

**M4: Persistence + preview.**
Session history (SQLite), rendered frame/video preview, export `.blend` and `.py`.

**M5: Polish.**
Settings (Blender path, provider, model, keychain), onboarding via `doctor`, packaging, README with the real eval table.

## 8. Code conventions

**Rust**
- `cargo fmt`; `cargo clippy -- -D warnings` must pass. `thiserror` for library errors, `anyhow` only in the CLI binary.
- No `unwrap()`/`expect()` in non-test code. Prefer small modules and explicit types at crate boundaries.
- `flinch-core` must not depend on Tauri. Use `tracing` for logs.
- Bounded channels and bounded buffers for streamed output (low memory, no unbounded growth).

**TypeScript / React**
- `strict: true`; no `any`. Validate untrusted JSON with **zod**.
- Function components + hooks; Zustand for global state. Batch log-line rendering (rAF-throttled) so long runs stay smooth. Virtualize long lists.
- Types for IPC come from generated bindings, never hand-written.
- Keyboard-friendly and accessible (it is an editor).

**Python (`blender/`)**
- Blender's bundled Python only; **no third-party imports**.
- The harness never raises out of `main`; it always writes the result JSON.
- Keep `harness.py` and `checks.py` clean and commented. They are the credibility of the project.

**General**
- Small, focused commits; Conventional Commits (`feat:`, `fix:`, `eval:`, `chore:`).
- New checks, schema changes, and prompt changes come with tests.
- No new dependency without a one-line justification in the commit message.

## 9. Do / Don't

**Do**
- Run `bun run check` before declaring work done.
- Verify by running things (harness on a known-good and a known-bad script), not by assumption.
- Keep the harness schema backward compatible; bump `schema` if it must change.
- Ask before changing the stack, the pinned Blender version, or the eval definition.

**Don't**
- Don't use `npm`/`yarn`/`pnpm`.
- Don't add paid or vendor-locked SDKs, or require an API key for basic use.
- Don't execute generated scripts anywhere except through `harness.py`.
- Don't let the model see eval checks.
- Don't count "no exception" as success.
- Don't commit keys, `.blend` files, renders, or large `evals/results/` logs.
- Don't hardcode absolute paths or assume one OS; Blender locations and process handling differ on Windows, macOS, and Linux.

## 10. Known pitfalls

- **Grease Pencil API drift:** v2 (<= 4.2) vs v3 (>= 4.3). Target the pinned version; include 2-3 working GP examples in `prompts/examples/`.
- **`bpy.ops` context errors** ("poll() failed") are the most common failure in background mode; steer the model toward `bpy.data`.
- **Headless rendering:** use Workbench for test renders; keep renders optional.
- **Small local models:** weaker at `bpy`, short context windows, chatty output. Keep feedback compact and extraction strict. Expect lower pass@1; that is exactly what the feedback loop should improve.
- **Free-tier APIs:** rate limits, quota resets, and models that disappear. Backoff, resumable evals, and no hardcoded model names.
- **Windows process trees:** killing the parent does not kill Blender; use a Job Object.
- **Hung scripts** (infinite loops, UI calls): rely on timeout + tree kill and report `stage: "timeout"` clearly.

## 11. Definition of done (per task)

1. `bun run check` passes (fmt, clippy, tests, typecheck, lint).
2. Tests added or updated.
3. Behavior verified by actually running it (harness, eval subset, or the app).
4. Docs updated if behavior, commands, config, or schema changed (`docs/EVALS.md` for anything eval-related).
5. Short summary: what changed, what was verified, what is unfinished. also do microcommits that is like after creating anything at every stage commit files and changes and ask me to allow commits and also create diff branches for diff features and tell me when to do PRs ...we need to cross atleast 100 commits and if more also then good...so start the project now..build everything as given
