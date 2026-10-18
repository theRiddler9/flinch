# Flinch Enhancement Specification: Viewport Controls, Auto-Framing, and Manual Blender Modeling Guides

> **Instructions for Claude**: You are enhancing **Flinch**, an open-source native desktop "Cursor for Blender".
> Read `AGENTS.md` in this repository before writing code. Respect all existing architecture, safety, and code quality standards.

---

## 1. Architectural Constraints & Rules (Strict)

1. **Zero Vendor Lock-In**:
   - Keep LLM access strictly on standard OpenAI-compatible endpoints (`/v1/chat/completions`). Do not import vendor SDKs (no official OpenAI, Anthropic, or Google Python/Node SDKs).
2. **Package Manager**:
   - **Bun only** (`bun install`, `bun run check`, `bun run build`). Never use npm, yarn, or pnpm.
3. **Strict TypeScript & React**:
   - `strict: true`, zero `any` types.
   - Use Zod for untrusted JSON validation.
   - Zustand for state management.
4. **Rust Core Ownership**:
   - All agent logic, provider streaming, and runner orchestration live in `crates/flinch-core`.
   - The Tauri desktop app (`apps/desktop/src-tauri`) is a thin shell over `flinch-core`.
   - Bounded channels, process-tree termination with Windows Job Objects, and typed errors with `thiserror`.
   - `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test --all` must pass with 0 warnings.
5. **Python Code Extraction**:
   - `flinch-core` extracts Python code strictly from a single fenced ```python ... ``` block. Any accompanying explanation or manual modeling guide must live outside this fenced code block so the harness executes purely valid Python.

---

## 2. Core Feature Requirements

### Feature 1: Manual Step-by-Step Blender Modeling Guide Alongside Generated Code

Currently, Flinch only outputs an executable Python script. Users want to learn how to model and modify the scene manually inside the Blender GUI.

1. **Prompt Engineering (`prompts/system.md`)**:
   - Instruct the LLM to structure its output into two clear sections:
     1. `### 🛠️ Manual Blender Step-by-Step Modeling Guide`:
        - A structured, numbered tutorial explaining how a 3D artist would manually build and detail this exact model directly in Blender.
        - Must mention specific tools, shortcuts, and menus (e.g. `Shift + A > Mesh > Cylinder`, `Tab` for Edit Mode, `Ctrl + R` for loop cuts, `E` to Extrude, `I` to Inset, `Ctrl + B` for Bevel, Modifiers tab settings like Subdivision Surface, and Shader Editor node setups).
        - Tips for further artistic customization and refinement.
     2. `### 🐍 Executable Blender Python (bpy) Script`:
        - Exactly one complete, standalone ```python ... ``` code block containing the fully executable script for headless execution.
2. **Agent Code Extraction (`crates/flinch-core/src/agent/loop_logic.rs`)**:
   - Verify `extract_python_code` isolates *only* the contents inside ```python ... ``` without capturing markdown guide text, headings, or other fenced blocks.
3. **UI Display (`apps/desktop/ui`)**:
   - In `ChatPanel.tsx` and/or `EditorPanel.tsx`, parse the manual modeling guide separately from the code.
   - Provide a clean tab or collapsible card ("📖 Manual Modeling Guide") with step badges and formatted shortcuts so users can read the guide side-by-side with the editor and viewport.

---

### Feature 2: Robust Scene Setup, Studio Lighting & Bounding-Box Auto-Framing

Generated models for arbitrary prompts (tiny props, massive buildings, multi-part characters) can end up off-center, tiny, or clipped outside the default camera view.

1. **Camera Framing in `blender/harness.py`**:
   - Implement an automated camera framing routine for test renders and preview snapshots:
     - Compute the combined 3D bounding box across all visible geometry objects (`MESH`, `CURVE`, `GREASEPENCIL`).
     - Adjust the active camera position, focal length, and target to cleanly frame the entire scene with comfortable padding (~15% margin).
2. **Studio Lighting & Materials Setup**:
   - In `prompts/system.md` instructions, guide the LLM to include clean default studio lighting (3-point Key/Fill/Rim or Sun with gradient background) if not specified by the user.
   - Ensure Principled BSDF node connections adhere to Blender 4.0+/5.2 standards.

---

### Feature 3: Enhanced Viewport Viewing Controls (`apps/desktop/ui`)

Currently, `FrameScrubber.tsx` displays a static 2D Workbench render with basic timeline scrubbing. Enhance the viewport viewing options:

1. **Camera Angle Presets**:
   - Add view angle selector buttons in the Viewport Canvas header:
     - **Active Camera** (default camera view)
     - **Front View** (orthographic front)
     - **Side View** (orthographic right)
     - **Top View** (orthographic top)
     - **Turntable / Isometric 3/4** (elevated 45° perspective)
   - In `src-tauri/src/lib.rs` and `blender/harness.py`, support passing an optional `--view` parameter (`camera`, `front`, `side`, `top`, `iso`) when evaluating and rendering a frame.
2. **Shading Mode Switcher**:
   - Quick toggles in the Viewport header for shading styles:
     - **Solid / Workbench** (with Cavity + MatCap for clear geometric detail)
     - **Wireframe** (shows polygon wireframe overlay)
     - **Rendered / Material Preview**
3. **High-Res Snapshot Export**:
   - Add a "Snapshot" button in the Viewport header that triggers a high-res single-frame render and saves it via the OS save dialog (`@tauri-apps/plugin-dialog`).

---

## 3. Verification & Quality Checklist

Before submitting changes, make sure all tests pass:

```bash
# 1. Update generated TypeScript bindings from Rust types
bun run bindings

# 2. Run comprehensive backend & frontend quality checks
bun run check

# 3. Verify desktop production build
bun run build

# 4. Verify Python harness unit tests
pytest blender/tests/test_harness.py
```

---

## 4. Git Commit Standards

Organize changes into focused Conventional Commits authored by Claude:

- `feat(prompts): add structured manual modeling guide and studio auto-framing instructions`
- `feat(harness): implement bounding-box camera auto-framing and multi-angle preview support`
- `feat(desktop): wire multi-angle and shading options through tauri commands to harness`
- `feat(ui): add dedicated manual modeling guide view and enhanced viewport camera controls`
- `fix(agent): preserve manual guide in chat while strictly isolating python block for execution`
