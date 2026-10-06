<h1 align="center">Flinch</h1>

<p align="center">A native desktop "Cursor for Blender", built with Rust and Tauri.</p>

<p align="center">
Describe an animation. Flinch writes the Blender script, <strong>runs it in headless Blender</strong>, reads the errors, and fixes it until it works.
</p>

---

## Features

- Chat-driven 3D and 2D (Grease Pencil) animation: prompt in, working `bpy` script out.
- **Execute-and-repair loop:** every script is run in headless Blender; tracebacks and scene stats are fed back to the model automatically (up to 3 attempts).
- Monaco editor with diffs between attempts, a per-attempt error panel, and live Blender logs.
- **Free by default:** works with local models via Ollama, or free tiers of OpenRouter, Groq, and Google AI Studio. No paid SDK, no vendor lock-in.
- Session history in local SQLite; export the result as `.blend` or `.py`.
- Reproducible eval suite with published success rates (see below).

Everything runs on your machine. Generated scripts are executed in a temporary directory with a hard timeout. This is best-effort isolation, **not** a security sandbox, so read scripts you don't trust.

<!-- Add a screenshot or GIF here: docs/assets/flinch-demo.png -->
<p align="center"><img src="docs/assets/flinch-demo.png" alt="Flinch screenshot" width="85%"></p>

## Proof: eval results

30 prompts across three tiers (10 easy, 10 medium, 10 hard). A run **passes only if the script executes without error and every programmatic check on the resulting scene passes**. "It didn't crash" does not count. Each prompt is run 3 times; numbers are averaged.

| Model | Tier | n | executes@1 | pass@1 | pass@3 (with feedback) |
|---|---|---|---|---|---|
| _run `bun run eval` to fill this in_ | | | | | |

The gap between **pass@1** and **pass@3** is the effect of execution feedback. Methodology and full logs: [docs/EVALS.md](docs/EVALS.md).

## How it's put together

```
apps/desktop/ui  (React + TS)  <-- commands/events -->  apps/desktop/src-tauri  (thin Tauri shell)
                                                                  |
                                                         crates/flinch-core
                                                          |- agent/     loop, prompts, code extraction, feedback
                                                          |- provider/  OpenAI-compatible streaming client
                                                          |- runner/    spawn Blender, timeout, process-tree kill
                                                          |- store/     SQLite sessions and attempts
                                                                  |
                                                  blender -b --python blender/harness.py
                                                  (ast.parse -> exec -> scene stats -> checks -> JSON)

crates/flinch-cli   headless `flinch` binary: eval, run, harness, doctor (same core, no UI)
```

The desktop app and the eval suite call the **same Rust core and the same `harness.py`**, so the published numbers measure the real product.

## Setup

**Platform status:** developed on one platform first; others are unverified until marked below.

| OS | Status |
|---|---|
| Linux | _to be verified_ |
| Windows | _to be verified_ |
| macOS | _to be verified_ |

Requires Rust (version pinned in `rust-toolchain.toml`), Bun 1.x, Blender (**the LTS version in `blender/VERSION`**), the [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS, and one LLM provider (see below). Python is not needed separately; Flinch uses Blender's bundled Python.

From the repository root:

```bash
bun install
cp flinch.example.toml flinch.toml     # set your Blender path and provider
cargo run -p flinch-cli -- doctor      # checks Blender version and provider connectivity
bun run dev                            # launch the desktop app
```

### Choose a provider (all free options)

Flinch talks to any OpenAI-compatible chat endpoint. Set `base_url` and `model` in `flinch.toml`.

| Provider | Cost | Notes |
|---|---|---|
| **Ollama** (local) | Free, offline | Default. Use a coding-tuned model that fits your RAM/VRAM. |
| OpenRouter | Free models available | Rate-limited; model availability changes. |
| Groq | Free tier | Fast; rate-limited. |
| Google AI Studio | Free tier | Via its OpenAI-compatible endpoint. |

Keys are read from an environment variable (CLI) or your OS keychain (desktop app) and are never written to config files. Setup details: [docs/PROVIDERS.md](docs/PROVIDERS.md). Small local models are weaker at `bpy`, which is exactly what the feedback loop is for; compare models in the eval table.

## Usage

```bash
cargo run -p flinch-cli -- run "a red cube bouncing three times"       # full loop, headless
cargo run -p flinch-cli -- harness path/to/script.py                    # run one script through the harness
bun run eval                                                            # the 30-prompt eval
bun run eval -- --tier easy
bun run eval -- --provider ollama --model <name>
```

## Development

Read [AGENTS.md](AGENTS.md) before making changes. It lists the architecture rules, the build order, code conventions, and the eval definition. Before pushing:

```bash
bun run check    # cargo fmt + clippy + cargo test + typecheck + lint + bun test
```

Repo layout:

```
crates/flinch-core/    all backend logic (no Tauri dependency)
crates/flinch-cli/     headless CLI: eval, run, harness, doctor
apps/desktop/          Tauri shell + React UI
blender/               harness.py, checks.py, sample scripts, pinned VERSION
prompts/               system prompt, feedback template, bpy examples
evals/                 the 30 prompts and run results
docs/                  architecture, eval methodology, provider setup
```

## License

Choose a license (MIT or Apache-2.0 are common) and add a `LICENSE` file.