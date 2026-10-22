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

# Pure-Python framing math lives next to this file; Blender runs us via --python, so make sure
# our directory is importable.
try:
    _HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:  # pragma: no cover
    _HERE = os.path.join(os.getcwd(), "blender")
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
import framing  # noqa: E402

# Object types that produce visible geometry (used for framing the preview camera).
GEOM_TYPES = {
    "MESH", "CURVE", "SURFACE", "META", "FONT", "CURVES", "POINTCLOUD",
    "VOLUME", "GREASEPENCIL", "GPENCIL",
}

# Principled BSDF default base color. If a material still has this, the LLM never set it
# through nodes, so we must NOT overwrite mat.diffuse_color with it.
DEFAULT_BASE_COLOR = (0.8, 0.8, 0.8, 1.0)


# --------------------------------------------------------------------------------------
# AST Compatibility Rewriter (Blender 4.0+/5.2)
# --------------------------------------------------------------------------------------

SOCKET_HELPERS_CODE = '''
def _flinch_socket(inputs, name):
    if hasattr(inputs, "__getitem__"):
        try:
            return inputs[name]
        except (KeyError, IndexError):
            pass
    _aliases = {
        "Specular": "Specular IOR Level",
        "Transmission": "Transmission Weight",
        "Subsurface": "Subsurface Weight",
        "Subsurface Color": "Base Color",
        "Clearcoat": "Coat Weight",
        "Clearcoat Roughness": "Coat Roughness",
        "Coat": "Coat Weight",
        "Sheen": "Sheen Weight",
        "Emission": "Emission Color",
    }
    if name in _aliases and hasattr(inputs, "__getitem__"):
        try:
            return inputs[_aliases[name]]
        except (KeyError, IndexError):
            pass
    return inputs[name]

def _flinch_socket_get(inputs, name, default=None):
    if hasattr(inputs, "get"):
        val = inputs.get(name)
        if val is not None:
            return val
    _aliases = {
        "Specular": "Specular IOR Level",
        "Transmission": "Transmission Weight",
        "Subsurface": "Subsurface Weight",
        "Subsurface Color": "Base Color",
        "Clearcoat": "Coat Weight",
        "Clearcoat Roughness": "Coat Roughness",
        "Coat": "Coat Weight",
        "Sheen": "Sheen Weight",
        "Emission": "Emission Color",
    }
    if name in _aliases and hasattr(inputs, "get"):
        val = inputs.get(_aliases[name])
        if val is not None:
            return val
    return default
'''


class BlenderCompatRewriter(ast.NodeTransformer):
    """Rewrites legacy/deprecated Blender 2.8x-3.6x APIs into Blender 4.0+/5.2 compatible equivalents.
    Prevents common LLM hallucinations and breaking API changes from crashing scripts."""

    SOCKET_MAP = {
        "Specular": "Specular IOR Level",
        "Transmission": "Transmission Weight",
        "Subsurface": "Subsurface Weight",
        "Subsurface Color": "Base Color",
        "Clearcoat": "Coat Weight",
        "Clearcoat Roughness": "Coat Roughness",
        "Coat": "Coat Weight",
        "Sheen": "Sheen Weight",
        "Emission": "Emission Color",
    }

    def __init__(self):
        super().__init__()
        self.used_socket_helper = False

    def visit_Subscript(self, node):
        self.generic_visit(node)
        # Safely wrap node.inputs['Specular'] with fallback helper instead of unconditionally renaming
        if isinstance(node.value, ast.Attribute) and node.value.attr == "inputs":
            if isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, str):
                if node.slice.value in self.SOCKET_MAP:
                    self.used_socket_helper = True
                    return ast.Call(
                        func=ast.Name(id="_flinch_socket", ctx=ast.Load()),
                        args=[node.value, node.slice],
                        keywords=[],
                    )
        return node

    def visit_Call(self, node):
        self.generic_visit(node)
        # 1. Safely wrap node.inputs.get('Specular', ...)
        if isinstance(node.func, ast.Attribute) and node.func.attr == "get":
            if isinstance(node.func.value, ast.Attribute) and node.func.value.attr == "inputs":
                if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                    if node.args[0].value in self.SOCKET_MAP:
                        self.used_socket_helper = True
                        default_arg = node.args[1] if len(node.args) > 1 else ast.Constant(value=None)
                        return ast.Call(
                            func=ast.Name(id="_flinch_socket_get", ctx=ast.Load()),
                            args=[node.func.value, node.args[0], default_arg],
                            keywords=[],
                        )

        # 2. Rewrite bpy.ops.object.mode_set(mode='END'/'DEFAULT') -> mode='OBJECT'
        if isinstance(node.func, ast.Attribute) and node.func.attr == "mode_set":
            for kw in node.keywords:
                if kw.arg == "mode" and isinstance(kw.value, ast.Constant) and kw.value.value in ("END", "DEFAULT"):
                    kw.value.value = "OBJECT"
            if node.args and isinstance(node.args[0], ast.Constant) and node.args[0].value in ("END", "DEFAULT"):
                node.args[0].value = "OBJECT"

        # 3. Rewrite bpy.ops.mesh.primitive_torus_add(segments=...) -> major_segments
        if isinstance(node.func, ast.Attribute) and node.func.attr == "primitive_torus_add":
            for kw in node.keywords:
                if kw.arg == "segments":
                    kw.arg = "major_segments"

        return node

    def visit_Attribute(self, node):
        self.generic_visit(node)
        # 1. Rewrite modifier.subdivisions -> modifier.levels
        if node.attr in ("subdivisions", "subdivision_levels"):
            node.attr = "levels"

        # 2. Rewrite mat.grease_pencil.stroke_color -> mat.grease_pencil.color
        if node.attr == "stroke_color" and isinstance(node.value, ast.Attribute) and node.value.attr == "grease_pencil":
            node.attr = "color"

        return node


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

PREVIEW_CAMERA_NAME = "FlinchViewCam"
DEFAULT_PREVIEW_SIZE = (640, 360)
HIGH_RES_THRESHOLD = 1280  # widths at/above this get extra anti-aliasing (snapshots)


def _set(obj, attr, value):
    """setattr that never raises; RNA enums/props differ between Blender versions."""
    try:
        setattr(obj, attr, value)
        return True
    except (TypeError, AttributeError, ValueError, RuntimeError):
        return False


def resolve_engine(shading, engine):
    """solid/wireframe -> workbench; rendered -> the chosen engine (workbench becomes eevee);
    no shading (older callers) -> the engine as given."""
    engine = (engine or "workbench").lower()
    if not shading:
        return engine
    shading = shading.lower()
    if shading in ("solid", "wireframe"):
        return "workbench"
    if shading == "rendered":
        return "eevee" if engine == "workbench" else engine
    return engine


def _render_geometry(view_layer):
    return [o for o in view_layer.objects if o.type in GEOM_TYPES and not o.hide_render]


def _grease_pencil_points(ev_obj, matrix_world, limit=6000):
    """Best-effort world-space stroke points of a Grease Pencil v3 object."""
    pts = []
    try:
        for layer in ev_obj.data.layers:
            for gp_frame in layer.frames:
                for stroke in gp_frame.drawing.strokes:
                    for point in stroke.points:
                        pts.append(tuple(matrix_world @ Vector(point.position)))
                        if len(pts) >= limit:
                            return pts
    except Exception:
        return pts
    return pts


def _object_world_points(obj, depsgraph):
    try:
        ev = obj.evaluated_get(depsgraph)
        mw = ev.matrix_world
        if obj.type in ("GREASEPENCIL", "GPENCIL"):
            pts = _grease_pencil_points(ev, mw)
            if pts:
                return pts
        return [tuple(mw @ Vector(c)) for c in ev.bound_box]
    except Exception:
        t = obj.matrix_world.translation
        return [(t.x, t.y, t.z)]


def collect_object_boxes(scene, frames):
    """{object name: (min, max)} of renderable geometry, unioned across `frames` so animated
    motion stays inside the framing box. Restores the current frame."""
    keep = scene.frame_current
    boxes = {}
    try:
        for f in frames:
            scene.frame_set(f)
            depsgraph = bpy.context.evaluated_depsgraph_get()
            for obj in _render_geometry(bpy.context.view_layer):
                box = framing.box_from_points(_object_world_points(obj, depsgraph))
                if box is not None:
                    boxes[obj.name] = framing.union_boxes([boxes.get(obj.name), box])
    finally:
        scene.frame_set(keep)
    return boxes


def _sample_frames(scene, frame):
    step = max(1, (scene.frame_end - scene.frame_start) // 10)
    frames = set(range(scene.frame_start, scene.frame_end + 1, step))
    frames.update({scene.frame_start, scene.frame_end, frame})
    return sorted(frames)


def _usable_scene_camera(scene, notes):
    cam = scene.camera
    if cam is None or cam.type != "CAMERA":
        return None
    if cam.name not in scene.objects:
        try:
            scene.collection.objects.link(cam)
            bpy.context.view_layer.update()
            notes.append("Active camera was not linked to the scene; linked it.")
        except RuntimeError:
            return None
    return cam


def _apply_camera_plan(scene, plan):
    """Create the preview camera for a framing.plan_camera() dict and make it active.
    The scene's own camera object is never modified."""
    old = bpy.data.objects.get(PREVIEW_CAMERA_NAME)
    if old is not None:
        bpy.data.objects.remove(old, do_unlink=True)
    cam_data = bpy.data.cameras.new(PREVIEW_CAMERA_NAME)
    cam_data.sensor_fit = "AUTO"
    cam_data.sensor_width = framing.DEFAULT_SENSOR_WIDTH
    if plan["ortho"]:
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = plan["ortho_scale"]
    else:
        cam_data.type = "PERSP"
        cam_data.lens = plan["lens"]
    cam_data.clip_start = plan["clip_start"]
    cam_data.clip_end = plan["clip_end"]
    cam_obj = bpy.data.objects.new(PREVIEW_CAMERA_NAME, cam_data)
    scene.collection.objects.link(cam_obj)
    cam_obj.rotation_mode = "XYZ"
    cam_obj.location = plan["location"]
    cam_obj.rotation_euler = plan["rotation"]
    scene.camera = cam_obj
    bpy.context.view_layer.update()
    return cam_obj


def setup_view_camera(scene, frame, view, framing_mode, notes):
    """Aim a camera for the requested view. Returns "scene", "auto", or the preset name.

    Preset views (front/side/top/iso) always get a dedicated, tightly framed camera. `camera`
    keeps the scene's camera when it frames the subject well; otherwise it reframes (position,
    focal length, target, ~15% padding), keeping the artist's angle when the subject is still
    in front of the camera. Oversized flat backdrops (floors) are ignored when framing."""
    from bpy_extras.object_utils import world_to_camera_view

    view = framing.resolve_view(view)
    aspect = scene.render.resolution_x / float(scene.render.resolution_y)
    boxes = collect_object_boxes(scene, _sample_frames(scene, frame))
    subject, dropped = framing.robust_union(list(boxes.items()))
    if dropped:
        notes.append("Ignored backdrop object(s) when framing: " + ", ".join(sorted(dropped)))

    cam = _usable_scene_camera(scene, notes) if view == "camera" else None
    hint, reason = None, ""
    if view == "camera":
        if cam is None:
            reason = "no usable active camera"
        elif subject is None or framing_mode == "off":
            return "scene"
        else:
            projected = [tuple(world_to_camera_view(scene, cam, Vector(c))) for c in framing.box_corners(subject)]
            verdict = framing.assess_projection(projected)
            ok, reason = framing.camera_is_acceptable(verdict)
            if ok:
                return "scene"
            if verdict["center_visible"]:
                t, c = cam.matrix_world.translation, framing.box_center(subject)
                hint = (t.x - c[0], t.y - c[1], t.z - c[2])

    plan = framing.plan_camera(view, subject, aspect, direction_hint=hint)
    _apply_camera_plan(scene, plan)
    scene.frame_set(frame)
    if view == "camera":
        notes.append(f"Auto-framed camera ({reason}): {plan['lens']:.0f}mm lens, {plan['distance']:.2f} units from target.")
        return "auto"
    notes.append(f"Using {view} view camera.")
    return view


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


def configure_output(scene, path, width=None, height=None, background=(0.16, 0.17, 0.19)):
    r = scene.render
    r.resolution_x = int(width) if width else DEFAULT_PREVIEW_SIZE[0]
    r.resolution_y = int(height) if height else DEFAULT_PREVIEW_SIZE[1]
    r.resolution_percentage = 100
    r.filepath = path.replace("\\", "/")  # forward slashes: safe on Windows with use_file_extension off
    r.use_file_extension = False          # write exactly to `path`
    r.image_settings.file_format = "PNG"
    _set(r.image_settings, "color_mode", "RGB")
    _set(r, "film_transparent", False)
    _set(r, "use_sequencer", False)       # stray VSE strips would replace the 3D render
    _set(r, "use_compositing", False)     # LLM-made compositor nodes can alter output
    _set(r, "use_motion_blur", False)
    vs = scene.view_settings              # AgX/Filmic wash saturated colors toward grey
    _set(vs, "view_transform", "Standard")
    _set(vs, "look", "None")
    _set(vs, "exposure", 0.0)
    _set(vs, "gamma", 1.0)
    _set(vs, "use_curve_mapping", False)
    if scene.world is None:
        scene.world = bpy.data.worlds.new("FlinchWorld")
    _set(scene.world, "color", background)  # Workbench background


def _principled_base_color(mat):
    """Base color of the material's Principled BSDF, or None if it can't be determined."""
    nt = getattr(mat, "node_tree", None)
    if nt is None:
        return None
    bsdf = None
    out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and getattr(n, "is_active_output", True)), None)
    if out is not None:
        surf = out.inputs.get("Surface")
        if surf is not None and surf.is_linked and surf.links[0].from_node.type == "BSDF_PRINCIPLED":
            bsdf = surf.links[0].from_node
    if bsdf is None:  # match by type, never by name ("Principled BSDF.001" etc.)
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    sock = bsdf.inputs.get("Base Color") if bsdf is not None else None
    if sock is None:
        return None
    if sock.is_linked:
        src = sock.links[0].from_node
        return tuple(src.outputs[0].default_value) if src.type == "RGB" else None
    return tuple(sock.default_value)


def sync_workbench_colors():
    """Copy node base colors into mat.diffuse_color (what Workbench draws) without clobbering a
    viewport color the script set directly."""
    changed = 0
    for mat in bpy.data.materials:
        col = _principled_base_color(mat)
        if col is None or all(abs(a - b) < 1e-4 for a, b in zip(col, DEFAULT_BASE_COLOR)):
            continue
        mat.diffuse_color = col
        changed += 1
    return changed


def _first_matcap_name():
    try:
        for light in bpy.context.preferences.studio_lights:
            if light.type == "MATCAP":
                return light.name
    except Exception:
        pass
    return None


def add_wireframe_modifiers(scene, notes):
    """Thin, scale-aware Wireframe modifier on every mesh (render-time only: the .blend export
    is saved before previews are rendered)."""
    count = 0
    for obj in _render_geometry(bpy.context.view_layer):
        if obj.type != "MESH" or not obj.data.polygons:
            continue
        try:
            avg_scale = sum(abs(s) for s in obj.scale) / 3.0  # thickness is in local units
            world_size = max(obj.dimensions) if max(obj.dimensions) > 1e-6 else 1.0
            mod = obj.modifiers.new("FlinchWire", "WIREFRAME")
            mod.thickness = max(world_size * 0.006 / max(avg_scale, 1e-6), 1e-5)
            _set(mod, "use_replace", True)
            _set(mod, "use_even_offset", True)
            count += 1
        except Exception:
            continue
    if count:
        notes.append(f"Wireframe overlay applied to {count} mesh object(s).")
    return count


def configure_workbench(scene, shading, matcap, notes):
    """Workbench look for the Solid and Wireframe shading modes."""
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    if shading == "wireframe":
        _set(sh, "light", "FLAT")
        _set(sh, "color_type", "SINGLE")
        _set(sh, "single_color", (0.55, 0.80, 1.0))
        _set(sh, "show_cavity", False)
        _set(sh, "show_object_outline", False)
        _set(scene.world, "color", (0.035, 0.045, 0.06))
        add_wireframe_modifiers(scene, notes)
        return
    _set(sh, "color_type", "MATERIAL")
    _set(sh, "show_cavity", True)           # darken creases / lift ridges so shape reads clearly
    _set(sh, "cavity_type", "BOTH")
    _set(sh, "cavity_ridge_factor", 1.0)
    _set(sh, "cavity_valley_factor", 1.0)
    _set(sh, "show_object_outline", True)
    name = _first_matcap_name() if matcap else None
    if name and _set(sh, "light", "MATCAP"):
        _set(sh, "studio_light", name)
        notes.append(f"MatCap lighting: {name} (replaces material colors).")
    else:
        if matcap:
            notes.append("No MatCap available in this Blender build; using studio lighting.")
        _set(sh, "light", "STUDIO")
        n = sync_workbench_colors()
        if n:
            notes.append(f"Synced {n} material color(s) for Workbench.")


def apply_engine(scene, name, notes, shading=None, matcap=False, high_res=False):
    """Configure the render engine. Returns the engine identifier actually set."""
    if name == "workbench":
        configure_workbench(scene, "wireframe" if shading == "wireframe" else "solid", matcap, notes)
        _set(scene.display, "render_aa", "16" if high_res else "8")
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
    """True if the image is a single flat color. None if it can't be checked."""
    try:
        import numpy as np
        img = bpy.data.images.load(path, check_existing=False)
        try:
            arr = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
            img.pixels.foreach_get(arr)
        finally:
            bpy.data.images.remove(img)
        return bool(float(arr.reshape(-1, 4)[:, :3].std(axis=0).max()) < 1e-3)
    except Exception:
        return None


def _leave_edit_mode():
    try:
        obj = bpy.context.object
        if obj is not None and obj.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
    except Exception:
        pass


def _preview_options(opts):
    opts = dict(opts or {})
    opts["view"] = framing.resolve_view(opts.get("view"))
    opts["shading"] = (opts.get("shading") or "").lower() or None
    opts["matcap"] = bool(opts.get("matcap"))
    opts["framing"] = (opts.get("framing") or "auto").lower()
    return opts


def _engine_chain(engine):
    return [engine] + [e for e in ("workbench", "cycles_fast") if e != engine]


def render_preview(scene, path, frame, engine, opts=None):
    """Render one frame to `path`. Never raises; returns a report dict stored under
    result["render"] (a render problem must not turn a working script into a failed one)."""
    opts = _preview_options(opts)
    engine = resolve_engine(opts["shading"], engine)
    width, height = opts.get("width"), opts.get("height")
    high_res = bool(width and int(width) >= HIGH_RES_THRESHOLD)
    path = path.replace("\\", "/")
    notes = []
    info = {"ok": False, "path": path, "frame": frame, "engine": None, "camera": None,
            "view": opts["view"], "shading": opts["shading"] or "solid",
            "blank": None, "notes": notes, "attempts": [], "error": None}
    try:
        _leave_edit_mode()
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        if os.path.exists(path):
            os.remove(path)  # never mistake a stale file for a fresh render
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        configure_output(scene, path, width, height)
        info["camera"] = setup_view_camera(scene, frame, opts["view"], opts["framing"], notes)

        for eng in _engine_chain(engine):  # requested -> Workbench -> Cycles CPU (needs no GPU)
            try:
                used = apply_engine(scene, eng, notes, opts["shading"], opts["matcap"], high_res)
                bpy.context.view_layer.update()
                res = bpy.ops.render.render(write_still=True, scene=scene.name)
                if "FINISHED" not in res:
                    raise RuntimeError(f"render operator returned {sorted(res)}")
                if not (os.path.isfile(path) and os.path.getsize(path) > 0):
                    raise RuntimeError("render finished but no image file was written")
                info.update(ok=True, engine=used)
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


def render_sequence_preview(scene, render_dir, start_f, end_f, engine, opts=None):
    """Render frames [start_f, end_f] into render_dir as frame_<f>.png in one Blender process."""
    opts = _preview_options(opts)
    engine = resolve_engine(opts["shading"], engine)
    render_dir = os.path.abspath(render_dir).replace("\\", "/")
    os.makedirs(render_dir, exist_ok=True)
    notes = []
    info = {"ok": False, "frames": [], "notes": notes, "error": None,
            "view": opts["view"], "shading": opts["shading"] or "solid"}
    try:
        _leave_edit_mode()
        scene.frame_set(start_f)
        bpy.context.view_layer.update()
        configure_output(scene, f"{render_dir}/test.png", opts.get("width"), opts.get("height"))
        info["camera"] = setup_view_camera(scene, start_f, opts["view"], opts["framing"], notes)
        ensure_light(scene, notes)
        last_error = None
        for eng in _engine_chain(engine):
            try:
                apply_engine(scene, eng, notes, opts["shading"], opts["matcap"])
                last_error = None
                break
            except Exception as e:
                last_error = e
        if last_error is not None:
            raise last_error
        for f in range(start_f, end_f + 1):
            scene.frame_set(f)
            bpy.context.view_layer.update()
            frame_path = f"{render_dir}/frame_{f}.png"
            scene.render.filepath = frame_path
            res = bpy.ops.render.render(write_still=True, scene=scene.name)
            if "FINISHED" in res and os.path.isfile(frame_path) and os.path.getsize(frame_path) > 0:
                info["frames"].append(f)
        info["ok"] = len(info["frames"]) > 0
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
        "rewritten_script": None,
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
    parser.add_argument("--render-frames", nargs=2, type=int, required=False, metavar=("START", "END"),
                        help="Render a sequence of frames [start, end] into --render-dir")
    parser.add_argument("--render-dir", required=False, help="Directory for rendered frame sequence")
    parser.add_argument("--engine", required=False, default="workbench",
                        help="workbench (default), eevee, cycles_fast, cycles_prod")
    parser.add_argument("--view", default="camera", help="camera (default), front, side, top, iso")
    parser.add_argument("--shading", default=None,
                        help="solid, wireframe, rendered. Omit to use --engine as given")
    parser.add_argument("--matcap", action="store_true", help="MatCap lighting in solid shading")
    parser.add_argument("--width", type=int, help="Preview width in pixels (default 640)")
    parser.add_argument("--height", type=int, help="Preview height in pixels (default 360)")
    parser.add_argument("--framing", default="auto", choices=["auto", "off"],
                        help="auto: reframe the camera when it misses the subject; off: keep it")

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

        # 1. Syntax check & compatibility transformation
        try:
            tree = ast.parse(code)
            try:
                rewriter = BlenderCompatRewriter()
                tree = rewriter.visit(tree)
                if rewriter.used_socket_helper:
                    helper_tree = ast.parse(SOCKET_HELPERS_CODE)
                    tree.body = helper_tree.body + tree.body
                ast.fix_missing_locations(tree)
                unparsed = ast.unparse(tree)
                if unparsed != code:
                    result["rewritten_script"] = unparsed
                    try:
                        with open(args.script, "w") as f:
                            f.write(unparsed)
                    except Exception:
                        pass
                compiled_code = compile(tree, "<generated>", "exec")
            except Exception as rewrite_err:
                result["warnings"].append(f"Compatibility transformation skipped: {rewrite_err}")
                compiled_code = compile(code, "<generated>", "exec")
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
        exec_globals = {
            "__name__": "__main__",
        }
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                exec(compiled_code, exec_globals)
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

            preview_opts = {"view": args.view, "shading": args.shading, "matcap": args.matcap,
                            "width": args.width, "height": args.height, "framing": args.framing}
            if args.view and args.view not in framing.VIEWS:
                result["warnings"].append(f"Unknown --view {args.view!r}; using 'camera'.")
            if args.shading and args.shading.lower() not in ("solid", "wireframe", "rendered"):
                result["warnings"].append(f"Unknown --shading {args.shading!r}; using the engine preset.")

            if render_path:
                engine = (args.engine or "workbench").lower()
                info = render_preview(scene, render_path, frame, engine, preview_opts)
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

            if getattr(args, "render_frames", None) and getattr(args, "render_dir", None):
                engine = (args.engine or "workbench").lower()
                start_f, end_f = args.render_frames
                seq_info = render_sequence_preview(scene, args.render_dir, start_f, end_f, engine, preview_opts)
                result["sequence_render"] = seq_info

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
