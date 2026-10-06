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
