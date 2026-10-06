# M0: Core + Harness + CLI Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core backend logic in Rust, the Python harness for Blender, and the CLI for Flinch without the UI.

**Architecture:** A Rust workspace with `flinch-core` and `flinch-cli`. `flinch-core` handles LLM interactions, Blender execution (via `runner`), and agent loops. `blender/harness.py` provides an entry point to evaluate Python code within Blender and outputs JSON results.

**Tech Stack:** Rust (tokio, reqwest, rusqlite, clap, thiserror), Python (bpy), Bun (for tasks)

**Spec:** `docs/superpowers/specs/2026-10-06-flinch-design.md` (and `AGENTS.md`)

## Global Constraints
- Backend must be in Rust, workspace of crates.
- In-Blender harness must be Python 3 (`bpy`) in `blender/harness.py`.
- No paid, vendor-locked SDKs. Use OpenAI-compatible chat API.
- Pinned Blender version: `blender/VERSION` (default: 4.5).
- Microcommits after creating anything at every stage.

## Review Focus
- Harness failure without JSON output -> ensure harness always outputs JSON even on crash.
- Blender process hanging -> implement hard timeout and whole process tree kill.
- LLM response contains Markdown wrapping instead of raw code -> robust extraction.
- Rate limiting on LLM provider -> implement backoff on 429.
- Invalid Blender binary path -> `doctor` command should detect and fail loudly.

---

### Task 1: Repository Setup and Initial Configuration

**Files:**
- Create: `Cargo.toml`, `rust-toolchain.toml`, `package.json`, `bunfig.toml`, `flinch.example.toml`, `.env.example`, `blender/VERSION`

**Interfaces:**
- Consumes: None
- Produces: Base repository structure for future tasks.

- [ ] **Step 1: Initialize Git and branch**

```bash
git checkout -b feature/m0-setup
```

- [ ] **Step 2: Create Cargo.toml workspace root**

```toml
[workspace]
members = [
    "crates/flinch-core",
    "crates/flinch-cli"
]
resolver = "2"
```

- [ ] **Step 3: Create rust-toolchain.toml**

```toml
[toolchain]
channel = "stable"
```

- [ ] **Step 4: Create package.json and bunfig.toml**

```json
{
  "name": "flinch",
  "version": "0.1.0",
  "scripts": {
    "check": "cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test --all"
  }
}
```

```toml
# bunfig.toml
[install]
```

- [ ] **Step 5: Create flinch.example.toml and .env.example**

```toml
[blender]
bin = "/path/to/blender"

[provider]
kind = "openai_compatible"
base_url = "http://localhost:11434/v1"
model = "llama3"
api_key_env = ""
max_concurrency = 1
```

```env
# .env.example
OPENAI_API_KEY=
```

- [ ] **Step 6: Create blender/VERSION**

```text
4.5
```

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "chore: initial repository setup for rust workspace and bun scripts"
```

---

### Task 2: Python Harness and Checks scaffolding

**Files:**
- Create: `blender/harness.py`
- Create: `blender/checks.py`
- Create: `blender/tests/test_harness.py`

**Interfaces:**
- Produces: `harness.py` which accepts `--script` and `--out` to evaluate Blender python scripts and dump result.

- [ ] **Step 1: Write a basic test for harness**

*(Will be done by subagent - minimal test validating that python script can execute and write JSON)*

- [ ] **Step 2: Create blender/harness.py top-level try/finally**

```python
import sys
import json
import traceback

def main():
    result = {"schema": 1, "ok": False, "stage": "syntax"}
    out_path = "result.json"
    
    try:
        # TODO: Parse args and exec script
        result["ok"] = True
        result["stage"] = "ok"
    except Exception as e:
        result["error"] = {"type": type(e).__name__, "message": str(e), "traceback": traceback.format_exc()}
    finally:
        with open(out_path, "w") as f:
            json.dump(result, f)

if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Commit**

```bash
git add blender/
git commit -m "feat: scaffold blender python harness and checks"
```

*(Note: In reality the subagent will follow TDD and fully implement the harness. We keep this simple for the plan).*

---

### Task 3: Rust Core Library (`flinch-core`) Setup

**Files:**
- Create: `crates/flinch-core/Cargo.toml`
- Create: `crates/flinch-core/src/lib.rs`

**Interfaces:**
- Produces: Initial flinch-core crate.

- [ ] **Step 1: Initialize flinch-core crate**

```bash
cargo new --lib crates/flinch-core
```

- [ ] **Step 2: Add dependencies**

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "stream"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"
rusqlite = { version = "0.31", features = ["bundled"] }
tracing = "0.1"
```

- [ ] **Step 3: Commit**

```bash
git add crates/flinch-core/
git commit -m "feat: setup flinch-core crate and dependencies"
```

---

### Task 4: CLI application (`flinch-cli`) Setup

**Files:**
- Create: `crates/flinch-cli/Cargo.toml`
- Create: `crates/flinch-cli/src/main.rs`

**Interfaces:**
- Produces: Binary `flinch` with `doctor`, `harness`, `run`, `eval` subcommands.

- [ ] **Step 1: Initialize flinch-cli crate**

```bash
cargo new crates/flinch-cli
```

- [ ] **Step 2: Add dependencies**

```toml
[dependencies]
flinch-core = { path = "../flinch-core" }
clap = { version = "4", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
anyhow = "1"
tracing-subscriber = "0.3"
```

- [ ] **Step 3: Setup basic CLI structure with clap in main.rs**

- [ ] **Step 4: Commit**

```bash
git add crates/flinch-cli/
git commit -m "feat: setup flinch-cli crate with clap subcommands"
```

---

*(More detailed tasks for LLM Provider, Runner, Eval Loop will be implemented via subagent execution)*
