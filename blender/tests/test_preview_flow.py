"""Harness preview path against a fake bpy (see fake_bpy.py): view selection, framing, shading, fallback."""
import importlib.util
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR = os.path.join(HERE, "..")
sys.path[:0] = [BLENDER_DIR, HERE]

import fake_bpy  # noqa: E402
import framing  # noqa: E402

CUBE_BOX = ((-1.0, -1.0, 0.0), (1.0, 1.0, 2.0))
LIMIT = 0.5 / (1 + framing.FRAME_PADDING)


def load(monkeypatch, **kw):
    bpy, mathutils, extras, utils = fake_bpy.make_bpy(**kw)
    for name, mod in (("bpy", bpy), ("mathutils", mathutils), ("bpy_extras", extras), ("bpy_extras.object_utils", utils)):
        monkeypatch.setitem(sys.modules, name, mod)
    spec = importlib.util.spec_from_file_location("harness_under_test", os.path.join(BLENDER_DIR, "harness.py"))
    h = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(h)
    assert h.HAS_BPY
    return h, bpy


def extent(bpy, cam, box):
    from bpy_extras.object_utils import world_to_camera_view
    worst = 0.0
    for c in framing.box_corners(box):
        v = world_to_camera_view(bpy.scene, cam, fake_bpy.Vector(c))
        assert v.z > 0
        worst = max(worst, abs(v.x - .5), abs(v.y - .5))
    return worst


def cube(bpy, name="Cube", loc=(0.0, 0.0, 1.0)):
    return fake_bpy.add_object(bpy, fake_bpy.FakeObject(name, "MESH", location=loc))


def bad_camera(bpy):
    cam = fake_bpy.FakeObject("Camera", "CAMERA", location=(5.0, 8.0, 5.0), data=bpy.data.cameras.new("Camera"))
    fake_bpy.add_object(bpy, cam)
    bpy.scene.camera = cam
    return cam


def test_missing_camera_is_auto_framed_with_padding(monkeypatch):
    h, bpy = load(monkeypatch)
    cube(bpy)
    assert h.setup_view_camera(bpy.scene, 1, "camera", "auto", []) == "auto"
    assert bpy.scene.camera.name == h.PREVIEW_CAMERA_NAME
    assert extent(bpy, bpy.scene.camera, CUBE_BOX) == pytest.approx(LIMIT, rel=1e-6)


def test_camera_staring_at_the_floor_is_replaced_not_modified(monkeypatch):
    h, bpy = load(monkeypatch)
    cube(bpy)
    bad = bad_camera(bpy)  # camera_add(location=...) with no rotation: the classic LLM bug
    assert h.setup_view_camera(bpy.scene, 1, "camera", "auto", []) == "auto"
    assert bpy.scene.camera is not bad and bad.location == (5.0, 8.0, 5.0)


def test_good_camera_kept_and_framing_off_respected(monkeypatch):
    h, bpy = load(monkeypatch)
    cube(bpy)
    good = fake_bpy.aim_camera(bpy, (6.0, -6.0, 4.0), (0.0, 0.0, 1.0))
    good.data.lens = 35.0
    assert h.setup_view_camera(bpy.scene, 1, "camera", "auto", []) == "scene" and bpy.scene.camera is good
    h, bpy = load(monkeypatch)
    cube(bpy)
    bad = bad_camera(bpy)
    assert h.setup_view_camera(bpy.scene, 1, "camera", "off", []) == "scene" and bpy.scene.camera is bad


@pytest.mark.parametrize("view,ortho", [("front", True), ("side", True), ("top", True), ("iso", False)])
def test_preset_views_get_their_own_framed_camera(monkeypatch, view, ortho):
    h, bpy = load(monkeypatch)
    cube(bpy)
    own = fake_bpy.aim_camera(bpy, (6.0, -6.0, 4.0), (0.0, 0.0, 1.0))
    assert h.setup_view_camera(bpy.scene, 1, view, "off", []) == view  # framing=off never affects presets
    cam = bpy.scene.camera
    assert cam is not own and (cam.data.type == "ORTHO") is ortho
    assert extent(bpy, cam, CUBE_BOX) <= LIMIT + 1e-6


def test_floor_ignored_and_animation_stays_in_frame(monkeypatch):
    h, bpy = load(monkeypatch)
    ball = cube(bpy, "Ball")
    ball.motion = lambda f: (f * 0.5, 0.0, 1.0 + 4.0 * abs(((f % 12) / 12.0) - 0.5))
    fake_bpy.add_object(bpy, fake_bpy.FakeObject("Floor", "MESH", half=(25.0, 25.0, 0.0)))
    notes = []
    h.setup_view_camera(bpy.scene, 1, "iso", "auto", notes)
    assert any("Floor" in n for n in notes)
    for f in range(1, 25):
        bpy.scene.frame_set(f)
        box = framing.box_from_points([tuple(ball.matrix_world @ fake_bpy.Vector(c)) for c in ball.bound_box])
        assert extent(bpy, bpy.scene.camera, box) <= 0.5 + 1e-6, f"frame {f} leaves the view"


def test_empty_scene_and_grease_pencil_bounds(monkeypatch):
    h, bpy = load(monkeypatch)
    assert h.setup_view_camera(bpy.scene, 1, "camera", "auto", []) == "auto" and bpy.scene.camera
    pts = [type("P", (), {"position": p})() for p in ((-3, 0, -1), (3, 0, 2))]
    drawing = type("D", (), {"strokes": [type("S", (), {"points": pts})()]})()
    layer = type("L", (), {"frames": [type("F", (), {"drawing": drawing})()]})()
    gp = fake_bpy.FakeObject("GP", "GREASEPENCIL", half=(0, 0, 0), data=type("G", (), {"layers": [layer]})())
    fake_bpy.add_object(bpy, gp)
    assert h.collect_object_boxes(bpy.scene, [1])["GP"] == ((-3.0, 0.0, -1.0), (3.0, 0.0, 2.0))


def preview(h, bpy, tmp_path, engine="workbench", **opts):
    path = str(tmp_path / "out" / "preview.png")
    return h.render_preview(bpy.scene, path, 1, engine, opts), path


def test_solid_wireframe_and_matcap_shading(monkeypatch, tmp_path):
    h, bpy = load(monkeypatch)
    c = cube(bpy)
    info, path = preview(h, bpy, tmp_path, shading="solid")
    sh = bpy.scene.display.shading
    assert info["ok"] and info["engine"] == "BLENDER_WORKBENCH" and os.path.getsize(path) > 0
    assert sh.show_cavity is True and sh.cavity_type == "BOTH" and sh.light == "STUDIO"
    assert bpy.scene.view_settings.view_transform == "Standard"
    preview(h, bpy, tmp_path, shading="solid", matcap=True)
    assert sh.light == "MATCAP" and sh.studio_light == "basic_1.exr"
    info, _ = preview(h, bpy, tmp_path, shading="wireframe")
    assert info["shading"] == "wireframe" and [m.type for m in c.modifiers] == ["WIREFRAME"] and sh.light == "FLAT"


def test_rendered_uses_eevee_and_falls_back_when_it_fails(monkeypatch, tmp_path):
    h, bpy = load(monkeypatch)
    cube(bpy)
    info, _ = preview(h, bpy, tmp_path, shading="rendered")
    assert info["engine"] == "BLENDER_EEVEE" and any(o.type == "LIGHT" for o in bpy.scene.objects)
    h, bpy = load(monkeypatch, render_error_for="BLENDER_EEVEE")
    cube(bpy)
    info, _ = preview(h, bpy, tmp_path, engine="eevee", shading="rendered")
    assert info["ok"] and info["engine"] == "BLENDER_WORKBENCH" and [a["ok"] for a in info["attempts"]] == [False, True]


def test_size_legacy_engine_and_total_failure(monkeypatch, tmp_path):
    h, bpy = load(monkeypatch)
    cube(bpy)
    preview(h, bpy, tmp_path, shading="solid", view="front", width=1920, height=1080)
    assert bpy.renders[-1]["size"] == (1920, 1080)
    preview(h, bpy, tmp_path, shading="solid")
    assert bpy.renders[-1]["size"] == (640, 360)
    info, _ = preview(h, bpy, tmp_path, engine="cycles_fast")  # no shading: old behaviour
    assert info["engine"] == "CYCLES"

    def boom(**_kw):
        raise RuntimeError("no GPU")

    bpy.ops.render.render = boom
    info, _ = preview(h, bpy, tmp_path, shading="solid")
    assert info["ok"] is False and info["error"]["type"] == "RenderError" and len(info["attempts"]) == 2


def test_sequence_uses_one_camera_for_every_frame(monkeypatch, tmp_path):
    h, bpy = load(monkeypatch)
    cube(bpy, "Ball").motion = lambda f: (float(f), 0.0, 1.0)
    info = h.render_sequence_preview(bpy.scene, str(tmp_path / "seq"), 1, 4, "workbench",
                                     {"view": "iso", "shading": "solid"})
    assert info["ok"] and info["frames"] == [1, 2, 3, 4] and len({id(r["camera"]) for r in bpy.renders}) == 1
