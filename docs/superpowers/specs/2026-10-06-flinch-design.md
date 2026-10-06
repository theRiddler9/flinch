# Flinch Spec

This is the design doc as provided by the user.

(See `AGENTS.md` for the full spec).

**Key Deliverable for M0**: Core + harness + CLI eval, no UI.
Components:
- `harness.py`, `checks.py`
- `flinch-core` (provider, runner, agent loop)
- `flinch-cli` (`doctor`, `harness`, `run`, `eval`)
- first 10 easy prompts in `evals/prompts.json`

**Goal for M0:** `bun run eval -- --tier easy` runs end to end and writes results JSON + markdown table against a free provider.
