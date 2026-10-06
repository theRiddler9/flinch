import sys
import json
import traceback
import argparse
import ast
import time
import os

try:
    import bpy
    HAS_BPY = True
except ImportError:
    HAS_BPY = False

def collect_scene_stats():
    if not HAS_BPY:
        return {}
    
    stats = {
        "blender_version": ".".join(map(str, bpy.app.version)),
        "objects": [],
        "counts": {"mesh": 0, "light": 0, "camera": 0, "grease_pencil": 0},
        "frame_range": [bpy.context.scene.frame_start, bpy.context.scene.frame_end],
        "fps": bpy.context.scene.render.fps,
        "keyframe_count": 0
    }
    
    for obj in bpy.data.objects:
        has_anim = obj.animation_data is not None and obj.animation_data.action is not None
        stats["objects"].append({
            "name": obj.name,
            "type": obj.type,
            "has_animation": has_anim
        })
        if obj.type == 'MESH':
            stats["counts"]["mesh"] += 1
        elif obj.type == 'LIGHT':
            stats["counts"]["light"] += 1
        elif obj.type == 'CAMERA':
            stats["counts"]["camera"] += 1
        elif obj.type == 'GREASEPENCIL':
            stats["counts"]["grease_pencil"] += 1
            
        if has_anim:
            stats["keyframe_count"] += len(obj.animation_data.action.fcurves)
            
    return stats

def main():
    start_time = time.time()
    result = {
        "schema": 1,
        "ok": False,
        "stage": "syntax",
        "error": None,
        "stdout": "",
        "warnings": [],
        "scene_stats": {},
        "checks": [],
        "duration_ms": 0
    }
    
    parser = argparse.ArgumentParser()
    parser.add_argument("--script", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--spec", required=False)
    parser.add_argument("--render-test", action="store_true")
    
    # In Blender, sys.argv includes the blender executable and --, so we slice it
    if "--" in sys.argv:
        args_list = sys.argv[sys.argv.index("--") + 1:]
    else:
        args_list = sys.argv[1:]
        
    try:
        args = parser.parse_args(args_list)
        out_path = args.out
    except Exception as e:
        # If we can't even parse args, we try to write to result.json as a fallback
        out_path = "result.json"
        result["error"] = {"type": type(e).__name__, "message": str(e), "traceback": traceback.format_exc(), "line": 0}
        with open(out_path, "w") as f:
            json.dump(result, f)
        return

    try:
        with open(args.script, "r") as f:
            code = f.read()

        # 1. Syntax check
        try:
            ast.parse(code)
        except SyntaxError as e:
            result["stage"] = "syntax"
            result["error"] = {
                "type": "SyntaxError", 
                "message": str(e), 
                "traceback": traceback.format_exc(),
                "line": e.lineno or 0
            }
            return

        result["stage"] = "runtime"

        # 2. Runtime
        # Best effort warning scan (not a sandbox)
        forbidden = ["os.system", "subprocess", "socket", "shutil.rmtree"]
        for word in forbidden:
            if word in code:
                result["warnings"].append(f"Use of {word} is discouraged.")

        # Capture stdout/stderr? For now just exec
        # A more robust harness would redirect sys.stdout
        try:
            exec(code, {"__name__": "__main__"})
        except Exception as e:
            # Extract line number from traceback
            tb = traceback.extract_tb(sys.exc_info()[2])
            line_no = 0
            for frame in tb:
                if frame.filename == "<string>":
                    line_no = frame.lineno
            
            result["stage"] = "runtime"
            result["error"] = {
                "type": type(e).__name__,
                "message": str(e),
                "traceback": traceback.format_exc(),
                "line": line_no
            }
            return
            
        result["stage"] = "validation"
        
        # 3. Scene stats
        result["scene_stats"] = collect_scene_stats()
        
        # 4. Checks (stubbed)
        if args.spec:
            try:
                sys.path.append(os.path.dirname(__file__))
                import checks
                result["checks"] = checks.run_checks(args.spec, result["scene_stats"])
            except Exception as e:
                result["warnings"].append(f"Check eval failed: {e}")
            
        # 5. Render test (stubbed)
        if args.render_test:
            result["stage"] = "render"
            # TODO: render logic
            
        all_passed = True
        failed_checks = []
        for c in result.get("checks", []):
            if not c.get("passed", False):
                all_passed = False
                failed_checks.append(f"{c.get('id', 'Unknown')}: {c.get('detail', '')}")
                
        result["checks_passed"] = all_passed
        result["ok"] = all_passed
        if not all_passed:
            result["stage"] = "checks_failed"
            result["error"] = {
                "type": "CheckError",
                "message": "The following checks failed:\n" + "\n".join(failed_checks),
                "traceback": "",
                "line": 0
            }
        else:
            result["stage"] = "ok"
            
    except Exception as e:
        result["stage"] = "harness_error"
        result["error"] = {
            "type": type(e).__name__,
            "message": str(e),
            "traceback": traceback.format_exc(),
            "line": 0
        }
    finally:
        result["duration_ms"] = int((time.time() - start_time) * 1000)
        with open(out_path, "w") as f:
            json.dump(result, f)

if __name__ == "__main__":
    main()
