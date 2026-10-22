"""Minimal fake bpy/mathutils/bpy_extras for exercising harness.py's preview path without Blender.
Catches logic and attribute errors only; it cannot prove Blender-specific behaviour."""
import math
import os
import types

import framing
from types import SimpleNamespace as NS


class Vector:
    def __init__(self, v=(0.0, 0.0, 0.0)):
        self.x, self.y, self.z = (float(c) for c in v)

    def __iter__(self):
        yield from (self.x, self.y, self.z)

    def __getitem__(self, i):
        return (self.x, self.y, self.z)[i]


class Matrix:
    def __init__(self, loc):
        self.translation = Vector(loc)

    def __matmul__(self, v):
        t = self.translation
        return Vector((t.x + v[0], t.y + v[1], t.z + v[2]))


class NameList(list):
    def __contains__(self, item):
        return any(o.name == item for o in self) if isinstance(item, str) else super().__contains__(item)


class Modifiers(list):
    def new(self, name, type):  # noqa: A002
        self.append(NS(name=name, type=type, thickness=0.0))
        return self[-1]


class FakeObject:
    def __init__(self, name, type_="MESH", location=(0.0, 0.0, 0.0), half=(1.0, 1.0, 1.0), data=None):
        self.name, self.type, self.location, self.half = name, type_, tuple(location), half
        self.rotation_euler, self.rotation_mode, self.scale = (0.0, 0.0, 0.0), "XYZ", (1.0, 1.0, 1.0)
        self.dimensions = tuple(2 * h for h in half)
        self.hide_render, self.mode, self.motion = False, "OBJECT", None
        self.modifiers = Modifiers()
        self.data = data if data is not None else NS(polygons=[1])

    matrix_world = property(lambda self: Matrix(self.location))
    bound_box = property(lambda self: [(x, y, z) for x in (-self.half[0], self.half[0])
                                       for y in (-self.half[1], self.half[1]) for z in (-self.half[2], self.half[2])])

    def evaluated_get(self, _dg):
        return self


class FakeScene:
    def __init__(self):
        self.name, self.camera, self.world = "Scene", None, None
        self.frame_start, self.frame_end, self.frame_current = 1, 24, 1
        self.objects = NameList()
        self.collection = NS(objects=NS(link=lambda o: self.objects.append(o) if o not in self.objects else None))
        self.render = NS(resolution_x=1920, resolution_y=1080, resolution_percentage=100, filepath="",
                         use_file_extension=True, image_settings=NS(file_format="", color_mode=""),
                         engine="BLENDER_EEVEE")
        self.view_settings, self.cycles = NS(view_transform="AgX"), NS()
        self.display = NS(shading=NS(), render_aa="")

    def frame_set(self, f):
        self.frame_current = int(f)
        for o in self.objects:
            if o.motion is not None:
                o.location = o.motion(self.frame_current)


def make_bpy(render_error_for=None):
    bpy, scene = types.ModuleType("bpy"), FakeScene()

    class Objects(list):
        def get(self, name):
            return next((o for o in self if o.name == name), None)

        def new(self, name, data):
            obj = FakeObject(name, "CAMERA" if hasattr(data, "ortho_scale") else "LIGHT", data=data)
            self.append(obj)
            return obj

        def remove(self, obj, do_unlink=True):
            list.remove(self, obj)
            if do_unlink and obj in scene.objects:
                scene.objects.remove(obj)

    cam_new = lambda name: NS(name=name, lens=50.0, sensor_width=36.0, sensor_fit="AUTO", type="PERSP",  # noqa: E731
                              ortho_scale=6.0, clip_start=0.1, clip_end=100.0)
    bpy.data = NS(objects=Objects(), cameras=NS(new=cam_new), materials=[], images=NS(),
                  lights=NS(new=lambda name, type: NS(name=name, type=type, energy=1.0)),  # noqa: A006
                  worlds=NS(new=lambda name: NS(name=name, color=(0.05, 0.05, 0.05))))
    bpy.context = NS(scene=scene, object=None, evaluated_depsgraph_get=lambda: object(),
                     view_layer=NS(objects=property(lambda s: list(scene.objects))),
                     preferences=NS(studio_lights=[NS(type="MATCAP", name="basic_1.exr")]))

    class VL:
        objects = property(lambda self: list(scene.objects))
        update = staticmethod(lambda: None)

    bpy.context.view_layer = VL()
    bpy.app = NS(version=(5, 2, 0))
    items = [NS(identifier=i) for i in ("BLENDER_EEVEE", "BLENDER_WORKBENCH", "CYCLES")]
    bpy.types = NS(RenderSettings=NS(bl_rna=NS(properties={"engine": NS(enum_items=items)})))
    renders = []

    def render(write_still=False, scene=None):  # noqa: ARG001
        s = bpy.context.scene
        if render_error_for and s.render.engine == render_error_for:
            raise RuntimeError(f"cannot render with {s.render.engine}")
        os.makedirs(os.path.dirname(s.render.filepath), exist_ok=True)
        open(s.render.filepath, "wb").write(b"\x89PNG fake")
        renders.append({"engine": s.render.engine, "camera": s.camera,
                        "size": (s.render.resolution_x, s.render.resolution_y)})
        return {"FINISHED"}

    bpy.ops = NS(render=NS(render=render), object=NS(mode_set=lambda mode: None))
    bpy.renders, bpy.scene = renders, scene

    mathutils = types.ModuleType("mathutils")
    mathutils.Vector = Vector

    def world_to_camera_view(scn, cam, coord):
        a, b, c = cam.rotation_euler
        ca, sa, cb, sb, cc, sc = math.cos(a), math.sin(a), math.cos(b), math.sin(b), math.cos(c), math.sin(c)
        right = (cc * cb, sc * cb, -sb)
        up = (cc * sb * sa - sc * ca, sc * sb * sa + cc * ca, cb * sa)
        back = (cc * sb * ca + sc * sa, sc * sb * ca - cc * sa, cb * ca)
        rel = framing.sub(tuple(coord), cam.location)
        depth, xc, yc = -framing.dot(rel, back), framing.dot(rel, right), framing.dot(rel, up)
        aspect = scn.render.resolution_x / float(scn.render.resolution_y)
        if cam.data.type == "ORTHO":
            sx = cam.data.ortho_scale if aspect >= 1 else cam.data.ortho_scale * aspect
            sy = cam.data.ortho_scale / aspect if aspect >= 1 else cam.data.ortho_scale
            return Vector((xc / sx + .5, yc / sy + .5, depth))
        tx, ty = framing.fov_tangents(cam.data.lens, cam.data.sensor_width, aspect)
        d = depth if depth > 1e-9 else 1e-9
        return Vector((xc / d / (2 * tx) + .5, yc / d / (2 * ty) + .5, depth))

    extras, utils = types.ModuleType("bpy_extras"), types.ModuleType("bpy_extras.object_utils")
    utils.world_to_camera_view = world_to_camera_view
    extras.object_utils = utils
    return bpy, mathutils, extras, utils


def add_object(bpy, obj):
    bpy.data.objects.append(obj)
    bpy.scene.collection.objects.link(obj)
    return obj


def aim_camera(bpy, location, target, name="Camera"):
    r, u, b = framing.camera_basis(framing.normalize(framing.sub(location, target)))
    cam = FakeObject(name, "CAMERA", location=location, data=bpy.data.cameras.new(name))
    cam.rotation_euler = framing.basis_to_euler_xyz(r, u, b)
    add_object(bpy, cam)
    bpy.scene.camera = cam
    return cam
