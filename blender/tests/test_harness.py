import json
import os
import subprocess
import sys

BLENDER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
HARNESS = os.path.join(BLENDER_DIR, "harness.py")
sys.path.insert(0, BLENDER_DIR)

def test_harness_syntax_error(tmp_path):
    script = tmp_path / "script.py"
    script.write_text("def a(\n")
    out = tmp_path / "result.json"
    
    subprocess.run([sys.executable, HARNESS, "--script", str(script), "--out", str(out)])
    
    assert out.exists()
    result = json.loads(out.read_text())
    assert result["ok"] is False
    assert result["stage"] == "syntax"
    assert result["error"]["type"] == "SyntaxError"

def test_harness_runtime_error(tmp_path):
    script = tmp_path / "script.py"
    script.write_text("a = 1 / 0\n")
    out = tmp_path / "result.json"
    
    subprocess.run([sys.executable, HARNESS, "--script", str(script), "--out", str(out)])
    
    assert out.exists()
    result = json.loads(out.read_text())
    assert result["ok"] is False
    assert result["stage"] == "runtime"
    assert result["error"]["type"] == "ZeroDivisionError"

def test_harness_success(tmp_path):
    script = tmp_path / "script.py"
    script.write_text("a = 1 + 1\n")
    out = tmp_path / "result.json"
    
    subprocess.run([sys.executable, HARNESS, "--script", str(script), "--out", str(out)])
    
    assert out.exists()
    result = json.loads(out.read_text())
    assert result["ok"] is True
    assert result["stage"] == "ok"

def test_harness_ast_rewriter_and_script_saving(tmp_path):
    script = tmp_path / "script.py"
    script.write_text("""
class DummyNode:
    def __init__(self):
        self.inputs = {"Emission Color": 42}

node = DummyNode()
val = node.inputs['Emission']
assert val == 42
""")
    out = tmp_path / "result.json"
    
    subprocess.run([sys.executable, HARNESS, "--script", str(script), "--out", str(out)])
    
    assert out.exists()
    result = json.loads(out.read_text())
    assert result["ok"] is True
    assert result["stage"] == "ok"
    assert result.get("rewritten_script") is not None
    assert "_flinch_socket" in result["rewritten_script"]
    disk_content = script.read_text()
    assert "_flinch_socket" in disk_content



def run_harness(tmp_path, code, *extra, cwd=None):
    script = tmp_path / "script.py"
    script.write_text(code)
    out = tmp_path / "result.json"
    subprocess.run([sys.executable, HARNESS, "--script", str(script), "--out", str(out), *extra], cwd=cwd)
    return json.loads(out.read_text())


def test_harness_accepts_view_and_shading_args(tmp_path):
    result = run_harness(tmp_path, "a = 1\n", "--view", "front", "--shading", "wireframe", "--matcap",
                         "--width", "1920", "--height", "1080", "--framing", "off", "--engine", "workbench")
    assert result["ok"] is True and result["stage"] == "ok"


def test_harness_every_view_and_unknown_view(tmp_path):
    for view in ("camera", "front", "side", "top", "iso", "sideways"):
        assert run_harness(tmp_path, "a = 1\n", "--view", view)["ok"] is True, view


def test_harness_runs_from_any_working_directory(tmp_path):
    assert run_harness(tmp_path, "a = 1\n", cwd=tmp_path)["ok"] is True


def test_resolve_engine_mapping():
    import harness

    assert harness.resolve_engine("solid", "eevee") == "workbench"
    assert harness.resolve_engine("wireframe", "cycles_fast") == "workbench"
    assert harness.resolve_engine("rendered", "workbench") == "eevee"
    assert harness.resolve_engine("rendered", "cycles_fast") == "cycles_fast"
    assert harness.resolve_engine(None, "cycles_prod") == "cycles_prod"
    assert harness.resolve_engine(None, None) == "workbench"
