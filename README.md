<h1 align="center">Flinch</h1>

---

<p align="center">A native desktop client for AI-assisted Blender animation, built with Rust and Tauri.</p>

## Features

- Describe a 3D or 2D (Grease Pencil) animation in chat and get a working Blender `bpy` script.
- Every script runs in headless Blender; errors and scene stats go back to the model until it works (up to 3 attempts).
- Monaco editor with diffs between attempts, a per-attempt error panel, and live Blender logs.
- Free by default: local models through Ollama, or free tiers of OpenRouter, Groq, and Google AI Studio. No paid SDK.
- Session history in local SQLite; export results as `.blend` or `.py`.
- Reproducible 30-prompt eval reporting pass@1 and pass@3 per model.

Generated scripts run in a temporary directory with a hard timeout. This is best-effort isolation, not a security sandbox.

<!-- Add a screenshot: docs/assets/flinch-demo.png -->
<p align="center"><img src="docs/assets/flinch-demo.png" alt="Flinch screenshot" width="85%"></p>

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Rust (`tokio`, `reqwest`, `rusqlite`), organized as a Cargo workspace |
| Desktop shell | Tauri 2 |
| Frontend | React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Zustand, Monaco |
| LLM access | Any OpenAI-compatible endpoint (Ollama by default), no vendor SDK |
| Blender harness | Python (`bpy`) running in `blender -b` |
| Tooling | Bun for frontend packages and task scripts |

## Setup

**Platform support is unverified.** Flinch is developed on one platform first; macOS, Windows, and Linux results will be listed here once tested.

Requires Rust (version pinned in `rust-toolchain.toml`), Bun 1.x, Blender (the LTS version in `blender/VERSION`), the [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS, and an LLM provider such as [Ollama](https://ollama.com). Python is not needed separately; Flinch uses Blender's bundled Python.

From the repository root:

```bash
bun install
cp flinch.example.toml flinch.toml
cargo run -p flinch-cli -- doctor
bun run dev
```

Set your Blender path and provider in `flinch.toml`. Flinch defaults to Ollama at `http://localhost:11434/v1`; use `base_url` and `model` to point at any OpenAI-compatible provider. API keys are read from an environment variable (CLI) or your OS keychain (desktop app), never from config files. `doctor` checks the Blender version and provider connectivity. See [docs/PROVIDERS.md](docs/PROVIDERS.md) for provider setup.

Run the eval with `bun run eval`. Results and methodology are in [docs/EVALS.md](docs/EVALS.md).

## Development

Read [AGENTS.md](AGENTS.md) before making changes. It lists the architecture rules, build order, code conventions, and the eval definition. All backend logic lives in `crates/flinch-core`; the Tauri app is a thin shell over it. Run `bun run check` before pushing, which covers `cargo fmt`, `clippy`, `cargo test`, TypeScript typechecking, lint, and `bun test`. Formatting, compilation/type checking, and regressions must pass before pushing.

## License

Add a `LICENSE` file (MIT or Apache-2.0 are common) and name it here.