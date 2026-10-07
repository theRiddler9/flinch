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

def get_action_fcurves(action):
    """Universal fcurve extractor supporting Blender 4.x legacy and Blender 5.x slotted/layered actions."""
    if not action:
        return []
    if hasattr(action, "fcurves"):
        try:
            return list(action.fcurves)
        except Exception:
            pass
    curves = []
    if hasattr(action, "layers"):
        for layer in action.layers:
            if hasattr(layer, "strips"):
                for strip in layer.strips:
                    if hasattr(strip, "channelbags"):
                        for cb in strip.channelbags:
                            if hasattr(cb, "fcurves"):
                                curves.extend(list(cb.fcurves))
    return curves

def collect_scene_stats():
    if not HAS_BPY:
        return {
            "blender_version": "Unknown",
            "objects": [],
            "counts": {"mesh": 0, "light": 0, "camera": 0, "grease_pencil": 0},
            "frame_range": [1, 250],
            "fps": 24,
            "keyframe_count": 0
        }
    
    stats = {
        "blender_version": ".".join(map(str, bpy.app.version)),
        "objects": [],
        "counts": {"mesh": 0, "light": 0, "camera": 0, "grease_pencil": 0},
        "frame_range": [bpy.context.scene.frame_start, bpy.context.scene.frame_end],
        "fps": bpy.context.scene.render.fps,
        "keyframe_count": 0
    }
    
    for obj in bpy.data.objects:
        obj_curves = []
        if obj.animation_data and obj.animation_data.action:
            obj_curves = get_action_fcurves(obj.animation_data.action)
        has_anim = len(obj_curves) > 0 or bool(obj.animation_data and getattr(obj.animation_data, 'nla_tracks', None) and len(obj.animation_data.nla_tracks) > 0)
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
            
        stats["keyframe_count"] += len(obj_curves)
            
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
        "scene_stats": {
            "blender_version": ".".join(map(str, bpy.app.version)) if 'bpy' in globals() else "Unknown",
            "objects": [],
            "counts": {"mesh": 0, "light": 0, "camera": 0, "grease_pencil": 0},
            "frame_range": [1, 250],
            "fps": 24,
            "keyframe_count": 0
        },
        "checks": [],
        "duration_ms": 0
    }
    
    parser = argparse.ArgumentParser()
    parser.add_argument("--script", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--spec", required=False)
    parser.add_argument("--render-test", action="store_true")
    parser.add_argument("--save-blend", required=False, help="Path to save the .blend file")
    parser.add_argument("--render-image", required=False, help="Path to save a rendered image frame")
    parser.add_argument("--frame", type=int, required=False, help="Specific frame number to evaluate and render")
    parser.add_argument("--engine", required=False, default="eevee", help="Engine preset (eevee, cycles_fast, cycles_prod)")
    
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
            
        if HAS_BPY:
            if args.frame is not None:
                bpy.context.scene.frame_set(args.frame)
            
            if args.save_blend:
                blend_dest = os.path.abspath(args.save_blend)
                os.makedirs(os.path.dirname(blend_dest), exist_ok=True)
                bpy.ops.wm.save_as_mainfile(filepath=blend_dest)
            
            if args.render_image:
                if args.frame is not None:
                    bpy.context.scene.frame_set(args.frame)
                # Auto-add fallback preview camera if scene has no active camera
                if not bpy.context.scene.camera:
                    cam_data = bpy.data.cameras.new("FlinchPreviewCam")
                    cam_obj = bpy.data.objects.new("FlinchPreviewCam", cam_data)
                    bpy.context.scene.collection.objects.link(cam_obj)
                    cam_obj.location = (6.0, -6.0, 4.5)
                    cam_obj.rotation_euler = (1.1, 0.0, 0.785)
                    bpy.context.scene.camera = cam_obj
                    
                # Auto-add fallback light if scene has no lights
                has_light = any(obj.type == 'LIGHT' for obj in bpy.context.scene.collection.all_objects)
                if not has_light:
                    light_data = bpy.data.lights.new(name="FlinchPreviewLight", type='SUN')
                    light_data.energy = 3.0
                    light_obj = bpy.data.objects.new(name="FlinchPreviewLight", object_data=light_data)
                    bpy.context.scene.collection.objects.link(light_obj)
                    light_obj.rotation_euler = (0.785, 0.0, 0.785)
                bpy.context.scene.render.resolution_x = 640
                bpy.context.scene.render.resolution_y = 360
                bpy.context.scene.render.resolution_percentage = 100
                img_dest = os.path.abspath(args.render_image)
                os.makedirs(os.path.dirname(img_dest), exist_ok=True)
                bpy.context.scene.render.filepath = img_dest
                
                # Apply engine preset
                if args.engine == "cycles_fast":
                    bpy.context.scene.render.engine = 'CYCLES'
                    bpy.context.scene.cycles.samples = 16
                    bpy.context.scene.cycles.use_denoising = True
                elif args.engine == "cycles_prod":
                    bpy.context.scene.render.engine = 'CYCLES'
                    bpy.context.scene.cycles.samples = 128
                    bpy.context.scene.cycles.use_denoising = True
                elif args.engine == "eevee":
                    # Try EEVEE_NEXT for newer Blender versions, fallback to BLENDER_EEVEE
                    try:
                        bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
                    except TypeError:
                        bpy.context.scene.render.engine = 'BLENDER_EEVEE'
                else:
                    bpy.context.scene.render.engine = 'BLENDER_WORKBENCH'
                    bpy.context.scene.display.shading.color_type = 'MATERIAL'
                    bpy.context.scene.display.shading.light = 'STUDIO'
                    for mat in bpy.data.materials:
                        if mat.use_nodes and "Principled BSDF" in mat.node_tree.nodes:
                            bsdf = mat.node_tree.nodes["Principled BSDF"]
                            if "Base Color" in bsdf.inputs:
                                mat.diffuse_color = bsdf.inputs["Base Color"].default_value

                bpy.ops.render.render(write_still=True)
            
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
        out_abs = os.path.abspath(out_path)
        os.makedirs(os.path.dirname(out_abs), exist_ok=True)
        with open(out_abs, "w") as f:
            json.dump(result, f)

if __name__ == "__main__":
    main()
