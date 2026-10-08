import sys
import json
import traceback
import argparse
import ast
import time
import os
import io
import math
import tempfile
import contextlib

try:
    import bpy
    from mathutils import Vector
    HAS_BPY = True
except ImportError:
    HAS_BPY = False

# Object types that produce visible geometry (used for framing the preview camera).
GEOM_TYPES = {
    "MESH", "CURVE", "SURFACE", "META", "FONT", "CURVES", "POINTCLOUD",
    "VOLUME", "GREASEPENCIL", "GPENCIL",
}

# Principled BSDF default base color. If a material still has this, the LLM never set it
# through nodes, so we must NOT overwrite mat.diffuse_color with it.
DEFAULT_BASE_COLOR = (0.8, 0.8, 0.8, 1.0)


# --------------------------------------------------------------------------------------
# Scene statistics
# --------------------------------------------------------------------------------------

def get_action_fcurves(action):
    """Universal fcurve extractor supporting Blender 4.x legacy and 5.x slotted/layered actions."""
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
            "keyframe_count": 0,
            "fcurve_count": 0,
        }

    scene = bpy.context.scene
    stats = {
        "blender_version": ".".join(map(str, bpy.app.version)),
        "objects": [],
        "counts": {"mesh": 0, "light": 0, "camera": 0, "grease_pencil": 0},
        "frame_range": [scene.frame_start, scene.frame_end],
        "fps": scene.render.fps,
        "keyframe_count": 0,
        "fcurve_count": 0,
    }

    for obj in bpy.data.objects:
        obj_curves = []
        if obj.animation_data and obj.animation_data.action:
            obj_curves = get_action_fcurves(obj.animation_data.action)
        has_anim = len(obj_curves) > 0 or bool(
            obj.animation_data
            and getattr(obj.animation_data, "nla_tracks", None)
            and len(obj.animation_data.nla_tracks) > 0
        )
        stats["objects"].append({"name": obj.name, "type": obj.type, "has_animation": has_anim})
        if obj.type == "MESH":
            stats["counts"]["mesh"] += 1
        elif obj.type == "LIGHT":
            stats["counts"]["light"] += 1
        elif obj.type == "CAMERA":
            stats["counts"]["camera"] += 1
        elif obj.type in ("GREASEPENCIL", "GPENCIL"):
            stats["counts"]["grease_pencil"] += 1

        # Count real keyframes, not F-curves (one location key = 3 F-curves).
        stats["fcurve_count"] += len(obj_curves)
        stats["keyframe_count"] += sum(len(fc.keyframe_points) for fc in obj_curves)

    return stats


# --------------------------------------------------------------------------------------
# Headless preview rendering
# --------------------------------------------------------------------------------------

def _set(obj, attr, value):
    """setattr that never raises; RNA enums/props differ between Blender versions."""
    try:
        setattr(obj, attr, value)
        return True
    except (TypeError, AttributeError, ValueError, RuntimeError):
        return False


def _render_geometry(view_layer):
    return [o for o in view_layer.objects if o.type in GEOM_TYPES and not o.hide_render]


def bounds_at(scene, frame):
    """World-space (min, max) of renderable geometry at `frame`, or None if there is none."""
    scene.frame_set(frame)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    pts = []
    for obj in _render_geometry(bpy.context.view_layer):
        try:
            ev = obj.evaluated_get(depsgraph)
            mw = ev.matrix_world
            pts.extend(mw @ Vector(c) for c in ev.bound_box)
        except Exception:
            pts.append(obj.matrix_world.translation.copy())
    if not pts:
        return None
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def union_bounds(scene, frames):
    """Bounds across several frames so animated motion stays inside the auto camera's view."""
    keep = scene.frame_current
    boxes = [b for b in (bounds_at(scene, f) for f in frames) if b]
    scene.frame_set(keep)
    if not boxes:
        return None
    mn = Vector((min(b[0].x for b in boxes), min(b[0].y for b in boxes), min(b[0].z for b in boxes)))
    mx = Vector((max(b[1].x for b in boxes), max(b[1].y for b in boxes), max(b[1].z for b in boxes)))
    return mn, mx


def camera_sees(scene, cam, bounds):
    """True if the center of `bounds` is inside `cam`'s frame and in front of it."""
    from bpy_extras.object_utils import world_to_camera_view
    center = (bounds[0] + bounds[1]) / 2
    v = world_to_camera_view(scene, cam, center)
    return v.z > 0.0 and 0.0 <= v.x <= 1.0 and 0.0 <= v.y <= 1.0


def make_preview_camera(scene, bounds):
    """Create a camera that frames `bounds` (bounding sphere) and make it the scene camera."""
    rx, ry = scene.render.resolution_x, scene.render.resolution_y
    if bounds is None:
        bounds = (Vector((-2.0, -2.0, -2.0)), Vector((2.0, 2.0, 2.0)))
    mn, mx = bounds
    center = (mn + mx) / 2
    radius = max((mx - mn).length / 2, 0.5)

    cam_data = bpy.data.cameras.new("FlinchPreviewCam")
    cam_data.lens = 50.0
    cam_data.sensor_width = 36.0
    cam_data.sensor_fit = "AUTO"

    # AUTO sensor fit: the larger render dimension gets the sensor width.
    tan_big = math.tan(math.atan(cam_data.sensor_width / (2.0 * cam_data.lens)))
    aspect = rx / float(ry)
    if aspect >= 1.0:
        tan_w, tan_h = tan_big, tan_big / aspect
    else:
        tan_w, tan_h = tan_big * aspect, tan_big
    half_fov = math.atan(min(tan_w, tan_h))
    dist = (radius / math.sin(half_fov)) * 1.2

    direction = Vector((1.0, -1.2, 0.8)).normalized()
    loc = center + direction * dist

    cam_obj = bpy.data.objects.new("FlinchPreviewCam", cam_data)
    scene.collection.objects.link(cam_obj)
    cam_obj.location = loc
    cam_obj.rotation_euler = (center - loc).to_track_quat("-Z", "Y").to_euler()
    cam_data.clip_start = max(dist / 1000.0, 0.01)
    cam_data.clip_end = max(100.0, dist + radius * 4.0)
    scene.camera = cam_obj
    bpy.context.view_layer.update()
    return cam_obj


def ensure_camera(scene, frame, notes):
    """Guarantee scene.camera exists, is in the scene, and actually looks at the content."""
    cam = scene.camera
    if cam is not None and cam.name not in scene.objects:
        try:
            scene.collection.objects.link(cam)
            bpy.context.view_layer.update()
            notes.append("Active camera was not linked to the scene; linked it.")
        except RuntimeError:
            cam = None

    bounds_now = bounds_at(scene, frame)
    reason = None
    if cam is None:
        reason = "no active camera"
    elif cam.type != "CAMERA":
        reason = "active camera object is not a camera"
    elif bounds_now is not None and not camera_sees(scene, cam, bounds_now):
        # Classic LLM failure: bpy.ops.object.camera_add(location=...) leaves rotation at
        # (0,0,0), so the camera stares straight down at the floor and the subject is
        # out of frame, which renders as a flat grey image.
        reason = "scene camera does not frame the objects (likely missing rotation)"

    if reason is None:
        return "scene"

    step = max(1, (scene.frame_end - scene.frame_start) // 10)
    frames_to_sample = set(range(scene.frame_start, scene.frame_end + 1, step))
    frames_to_sample.update({scene.frame_start, scene.frame_end, frame})
    frames = sorted(frames_to_sample)
    make_preview_camera(scene, union_bounds(scene, frames))
    scene.frame_set(frame)
    notes.append(f"Used auto-framed preview camera: {reason}.")
    return "auto"


def ensure_light(scene, notes):
    if any(o.type == "LIGHT" and not o.hide_render for o in bpy.context.view_layer.objects):
        return
    light_data = bpy.data.lights.new("FlinchPreviewLight", "SUN")
    light_data.energy = 3.0
    light_obj = bpy.data.objects.new("FlinchPreviewLight", light_data)
    scene.collection.objects.link(light_obj)
    light_obj.rotation_euler = (math.radians(50), 0.0, math.radians(30))
    bpy.context.view_layer.update()
    notes.append("Added fallback sun light.")


def configure_output(scene, path):
    r = scene.render
    r.resolution_x = 640
    r.resolution_y = 360
    r.resolution_percentage = 100
    r.filepath = path
    r.use_file_extension = False          # write exactly to `path`
    r.image_settings.file_format = "PNG"
    _set(r.image_settings, "color_mode", "RGB")
    _set(r, "film_transparent", False)
    _set(r, "use_sequencer", False)       # stray VSE strips would replace the 3D render
    _set(r, "use_compositing", False)     # LLM-made compositor nodes can break/alter output
    _set(r, "use_motion_blur", False)

    # Default AgX/Filmic washes saturated colors toward grey. Use a neutral transform.
    vs = scene.view_settings
    _set(vs, "view_transform", "Standard")
    _set(vs, "look", "None")
    _set(vs, "exposure", 0.0)
    _set(vs, "gamma", 1.0)
    _set(vs, "use_curve_mapping", False)

    if scene.world is None:
        scene.world = bpy.data.worlds.new("FlinchWorld")
    _set(scene.world, "color", (0.16, 0.17, 0.19))  # Workbench background


def _principled_base_color(mat):
    """Base color of the material's Principled BSDF, or None if it can't be determined."""
    nt = getattr(mat, "node_tree", None)
    if nt is None:
        return None
    bsdf = None
    out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and getattr(n, "is_active_output", True)), None)
    if out is not None:
        surf = out.inputs.get("Surface")
        if surf is not None and surf.is_linked:
            src = surf.links[0].from_node
            if src.type == "BSDF_PRINCIPLED":
                bsdf = src
    if bsdf is None:  # match by type, never by name ("Principled BSDF.001" etc.)
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return None
    sock = bsdf.inputs.get("Base Color")
    if sock is None:
        return None
    if sock.is_linked:
        src = sock.links[0].from_node
        if src.type == "RGB":
            return tuple(src.outputs[0].default_value)
        return None  # textures etc.: Workbench can't show them via diffuse_color
    return tuple(sock.default_value)


def sync_workbench_colors():
    """Copy node base colors into mat.diffuse_color (what Workbench draws), without clobbering
    a viewport color the script set directly."""
    changed = 0
    for mat in bpy.data.materials:
        col = _principled_base_color(mat)
        if col is None:
            continue
        if all(abs(a - b) < 1e-4 for a, b in zip(col, DEFAULT_BASE_COLOR)):
            continue  # untouched default node color: keep whatever diffuse_color says
        mat.diffuse_color = col
        changed += 1
    return changed


def apply_engine(scene, name, notes):
    """Configure the render engine. Returns the engine identifier actually set."""
    if name == "workbench":
        scene.render.engine = "BLENDER_WORKBENCH"
        sh = scene.display.shading
        _set(sh, "light", "STUDIO")
        _set(sh, "color_type", "MATERIAL")
        _set(sh, "show_cavity", False)
        _set(scene.display, "render_aa", "8")
        n = sync_workbench_colors()
        if n:
            notes.append(f"Synced {n} material color(s) for Workbench.")
        return "BLENDER_WORKBENCH"

    if name in ("cycles_fast", "cycles_prod"):
        scene.render.engine = "CYCLES"
        c = scene.cycles
        _set(c, "device", "CPU")
        _set(c, "samples", 16 if name == "cycles_fast" else 128)
        _set(c, "use_denoising", True)
        ensure_light(scene, notes)
        return "CYCLES"

    if name == "eevee":
        ids = {i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
        eevee = next((x for x in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT") if x in ids), None)
        if eevee is None:
            raise RuntimeError("No EEVEE engine available in this Blender build")
        scene.render.engine = eevee
        ensure_light(scene, notes)
        return eevee

    raise ValueError(f"Unknown engine preset: {name}")


def image_is_blank(path):
    """True if the image is a single flat color (nothing visible). None if it can't be checked."""
    try:
        import numpy as np
        img = bpy.data.images.load(path, check_existing=False)
        try:
            arr = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
            img.pixels.foreach_get(arr)
        finally:
            bpy.data.images.remove(img)
        px = arr.reshape(-1, 4)[:, :3]
        return bool(float(px.std(axis=0).max()) < 1e-3)
    except Exception:
        return None


def render_preview(scene, path, frame, engine):
    """Render one frame to `path`. Never raises; returns a report dict.

    A render problem must not turn a working script into a failed one, so this is
    reported separately under result["render"].
    """
    notes = []
    info = {
        "ok": False, "path": path, "frame": frame, "engine": None, "camera": None,
        "blank": None, "notes": notes, "attempts": [], "error": None,
    }
    try:
        # Make sure edit mode / pending changes don't leave stale data.
        try:
            obj = bpy.context.object
            if obj is not None and obj.mode != "OBJECT":
                bpy.ops.object.mode_set(mode="OBJECT")
        except Exception:
            pass

        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        if os.path.exists(path):
            os.remove(path)  # never mistake a stale file for a fresh render

        scene.frame_set(frame)
        bpy.context.view_layer.update()
        configure_output(scene, path)
        info["camera"] = ensure_camera(scene, frame, notes)

        # Fallback chain: requested engine -> Workbench -> Cycles (CPU, needs no GPU/GL).
        chain = [engine] + [e for e in ("workbench", "cycles_fast") if e != engine]
        for eng in chain:
            try:
                used = apply_engine(scene, eng, notes)
                bpy.context.view_layer.update()
                res = bpy.ops.render.render(write_still=True, scene=scene.name)
                if "FINISHED" not in res:
                    raise RuntimeError(f"render operator returned {sorted(res)}")
                if not (os.path.isfile(path) and os.path.getsize(path) > 0):
                    raise RuntimeError("render finished but no image file was written")
                info["ok"] = True
                info["engine"] = used
                info["attempts"].append({"engine": eng, "ok": True})
                break
            except Exception as e:
                info["attempts"].append({"engine": eng, "ok": False, "error": f"{type(e).__name__}: {e}"})

        if info["ok"]:
            info["blank"] = image_is_blank(path)
            if info["blank"]:
                notes.append("Rendered image is one flat color: subject may be hidden, empty, or out of view.")
        else:
            last = info["attempts"][-1]["error"] if info["attempts"] else "unknown"
            info["error"] = {"type": "RenderError", "message": f"All render engines failed. Last error: {last}"}
    except Exception as e:
        info["error"] = {"type": type(e).__name__, "message": str(e), "traceback": traceback.format_exc()}
    return info


# --------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------

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
            "blender_version": ".".join(map(str, bpy.app.version)) if HAS_BPY else "Unknown",
            "objects": [],
            "counts": {"mesh": 0, "light": 0, "camera": 0, "grease_pencil": 0},
            "frame_range": [1, 250],
            "fps": 24,
            "keyframe_count": 0,
            "fcurve_count": 0,
        },
        "checks": [],
        "render": None,
        "duration_ms": 0,
    }

    parser = argparse.ArgumentParser()
    parser.add_argument("--script", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--spec", required=False)
    parser.add_argument("--render-test", action="store_true",
                        help="Render one frame to a temp file to verify the scene renders")
    parser.add_argument("--save-blend", required=False, help="Path to save the .blend file")
    parser.add_argument("--render-image", required=False, help="Path to save a rendered image frame")
    parser.add_argument("--frame", type=int, required=False, help="Frame to evaluate and render")
    parser.add_argument("--engine", required=False, default="workbench",
                        help="workbench (default), eevee, cycles_fast, cycles_prod")

    # Blender's sys.argv contains its own args; ours come after "--".
    if "--" in sys.argv:
        args_list = sys.argv[sys.argv.index("--") + 1:]
    else:
        args_list = sys.argv[1:]

    try:
        args = parser.parse_args(args_list)
        out_path = args.out
    except (Exception, SystemExit) as e:
        out_path = "result.json"
        result["error"] = {"type": type(e).__name__, "message": str(e),
                           "traceback": traceback.format_exc(), "line": 0}
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
            result["error"] = {"type": "SyntaxError", "message": str(e),
                               "traceback": traceback.format_exc(), "line": e.lineno or 0}
            return

        result["stage"] = "runtime"

        # 2. Runtime. Best-effort warning scan (not a sandbox).
        for word in ["os.system", "subprocess", "socket", "shutil.rmtree"]:
            if word in code:
                result["warnings"].append(f"Use of {word} is discouraged.")

        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                exec(compile(code, "<generated>", "exec"), {"__name__": "__main__"})
        except Exception as e:
            line_no = 0
            for frame in traceback.extract_tb(sys.exc_info()[2]):
                if frame.filename == "<generated>":
                    line_no = frame.lineno
            result["stdout"] = buf.getvalue()[-8000:]
            result["stage"] = "runtime"
            result["error"] = {"type": type(e).__name__, "message": str(e),
                               "traceback": traceback.format_exc(), "line": line_no}
            return
        result["stdout"] = buf.getvalue()[-8000:]

        result["stage"] = "validation"

        if HAS_BPY:
            # Leave edit mode and flush pending updates so stats, saves and renders see final state.
            try:
                obj = bpy.context.object
                if obj is not None and obj.mode != "OBJECT":
                    bpy.ops.object.mode_set(mode="OBJECT")
            except Exception:
                pass
            bpy.context.view_layer.update()

        # 3. Scene stats (collected BEFORE any preview camera/light is injected)
        result["scene_stats"] = collect_scene_stats()

        # 4. Checks
        if args.spec:
            try:
                here = os.path.dirname(os.path.abspath(__file__))
                if here not in sys.path:
                    sys.path.append(here)
                import checks
                result["checks"] = checks.run_checks(args.spec, result["scene_stats"])
            except Exception as e:
                result["warnings"].append(f"Check eval failed: {e}")

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
            result["error"] = {"type": "CheckError",
                               "message": "The following checks failed:\n" + "\n".join(failed_checks),
                               "traceback": "", "line": 0}
        else:
            result["stage"] = "ok"

        # 5. Save / render (these never change the script's own success state, except --render-test)
        if HAS_BPY:
            scene = bpy.context.scene
            frame = args.frame if args.frame is not None else scene.frame_start
            if args.frame is not None:
                scene.frame_set(frame)

            if args.save_blend:
                blend_dest = os.path.abspath(args.save_blend)
                os.makedirs(os.path.dirname(blend_dest), exist_ok=True)
                bpy.ops.wm.save_as_mainfile(filepath=blend_dest)

            render_path = None
            if args.render_image:
                render_path = os.path.abspath(args.render_image)
            elif args.render_test:
                render_path = os.path.join(tempfile.mkdtemp(prefix="flinch_"), "render_test.png")

            if render_path:
                engine = (args.engine or "workbench").lower()
                info = render_preview(scene, render_path, frame, engine)
                result["render"] = info
                if info.get("blank"):
                    result["warnings"].append("Preview render is a single flat color.")
                if args.render_test and not info["ok"]:
                    result["ok"] = False
                    result["stage"] = "render"
                    if result["error"] is None:
                        result["error"] = {"type": info["error"]["type"],
                                           "message": info["error"]["message"],
                                           "traceback": info["error"].get("traceback", ""), "line": 0}

    except Exception as e:
        result["stage"] = "harness_error"
        result["error"] = {"type": type(e).__name__, "message": str(e),
                           "traceback": traceback.format_exc(), "line": 0}
    finally:
        result["duration_ms"] = int((time.time() - start_time) * 1000)
        out_abs = os.path.abspath(out_path)
        os.makedirs(os.path.dirname(out_abs), exist_ok=True)
        with open(out_abs, "w") as f:
            json.dump(result, f, default=str)


if __name__ == "__main__":
    main()
