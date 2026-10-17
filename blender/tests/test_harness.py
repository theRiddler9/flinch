import json
import subprocess
import os

def test_harness_syntax_error(tmp_path):
    script = tmp_path / "script.py"
    script.write_text("def a(\n")
    out = tmp_path / "result.json"
    
    subprocess.run(["python", "blender/harness.py", "--script", str(script), "--out", str(out)])
    
    assert out.exists()
    result = json.loads(out.read_text())
    assert result["ok"] is False
    assert result["stage"] == "syntax"
    assert result["error"]["type"] == "SyntaxError"

def test_harness_runtime_error(tmp_path):
    script = tmp_path / "script.py"
    script.write_text("a = 1 / 0\n")
    out = tmp_path / "result.json"
    
    subprocess.run(["python", "blender/harness.py", "--script", str(script), "--out", str(out)])
    
    assert out.exists()
    result = json.loads(out.read_text())
    assert result["ok"] is False
    assert result["stage"] == "runtime"
    assert result["error"]["type"] == "ZeroDivisionError"

def test_harness_success(tmp_path):
    script = tmp_path / "script.py"
    script.write_text("a = 1 + 1\n")
    out = tmp_path / "result.json"
    
    subprocess.run(["python", "blender/harness.py", "--script", str(script), "--out", str(out)])
    
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
    
    subprocess.run(["python", "blender/harness.py", "--script", str(script), "--out", str(out)])
    
    assert out.exists()
    result = json.loads(out.read_text())
    assert result["ok"] is True
    assert result["stage"] == "ok"
    assert result.get("rewritten_script") is not None
    assert "_flinch_socket" in result["rewritten_script"]
    disk_content = script.read_text()
    assert "_flinch_socket" in disk_content

