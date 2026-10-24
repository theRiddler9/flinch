"""Unit tests for the pure-Python framing math (no Blender required)."""
import math
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import framing as f  # noqa: E402

ASPECT = 16 / 9
CUBE = ((-1.0, -1.0, 0.0), (1.0, 1.0, 2.0))
LIMIT = 1.0 / (1.0 + f.FRAME_PADDING)


def rot(a, b, c):
    ca, sa, cb, sb, cc, sc = math.cos(a), math.sin(a), math.cos(b), math.sin(b), math.cos(c), math.sin(c)
    return [[cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa],
            [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa],
            [-sb, cb * sa, cb * ca]]


def col(m, j): return (m[0][j], m[1][j], m[2][j])
def close(a, b, tol=1e-6): return all(abs(x - y) <= tol for x, y in zip(a, b))


@pytest.mark.parametrize("view", ["front", "side", "top", "iso"])
def test_euler_round_trips_to_basis(view):
    r, u, b = f.camera_basis(f.view_direction(view))
    m = rot(*f.basis_to_euler_xyz(r, u, b))
    assert close(col(m, 0), r) and close(col(m, 1), u) and close(col(m, 2), b)


def test_preset_rotations_match_blender_numpad_views():
    rotation = lambda v: f.plan_camera(v, CUBE, ASPECT)["rotation"]  # noqa: E731
    assert close(rotation("front"), (math.pi / 2, 0, 0))
    assert close(rotation("side"), (math.pi / 2, 0, math.pi / 2))
    assert close(rotation("top"), (0, 0, 0))


def test_preset_sides_and_projection_types():
    c = f.box_center(CUBE)
    assert f.plan_camera("front", CUBE, ASPECT)["location"][1] < c[1]
    assert f.plan_camera("side", CUBE, ASPECT)["location"][0] > c[0]
    assert f.plan_camera("top", CUBE, ASPECT)["location"][2] > c[2]
    iso = f.plan_camera("iso", CUBE, ASPECT)["location"]
    assert iso[0] > c[0] and iso[1] < c[1] and iso[2] > c[2]
    assert [f.plan_camera(v, CUBE, ASPECT)["ortho"] for v in ("front", "side", "top", "iso", "camera")] == \
        [True, True, True, False, False]


def test_front_ortho_scale_has_padding():
    assert f.plan_camera("front", CUBE, ASPECT)["ortho_scale"] == pytest.approx(2.0 * 1.15 * ASPECT)


def project(plan, p, aspect):
    r, u, b = f.camera_basis(plan["direction"])
    rel = f.sub(p, plan["location"])
    depth = -f.dot(rel, b)
    tx, ty = f.fov_tangents(plan["lens"], f.DEFAULT_SENSOR_WIDTH, aspect)
    return f.dot(rel, r) / depth / tx, f.dot(rel, u) / depth / ty, depth


@pytest.mark.parametrize("box", [CUBE, ((-50, -20, 0), (50, 20, 80)), ((-.01, -.02, 0), (.01, .02, .03)),
                                 ((-3, -.2, -1), (3, .2, 5))])
@pytest.mark.parametrize("aspect", [ASPECT, 9 / 16])
def test_perspective_fit_is_tight_and_padded(box, aspect):
    plan = f.plan_camera("iso", box, aspect)
    ext = []
    for p in f.box_corners(box):
        x, y, d = project(plan, p, aspect)
        assert d > 0
        ext.append(max(abs(x), abs(y)))
    assert max(ext) == pytest.approx(LIMIT, rel=1e-6)


def test_scale_invariant_and_clamped():
    big = tuple(tuple(c * 1000 for c in p) for p in CUBE)
    a, b = f.plan_camera("iso", CUBE, ASPECT), f.plan_camera("iso", big, ASPECT)
    assert b["lens"] == pytest.approx(a["lens"]) and b["distance"] == pytest.approx(a["distance"] * 1000)
    assert f.choose_focal_length(1.0, 10.0) == f.MIN_LENS
    assert f.choose_focal_length(0.0, ASPECT) == 50.0


def test_degenerate_inputs():
    assert f.plan_camera("iso", ((0, 0, 0), (0, 0, 0)), ASPECT)["distance"] > 1.0
    assert f.plan_camera("front", None, ASPECT)["ortho_scale"] > 0
    with pytest.raises(ValueError):
        f.plan_camera("bogus", CUBE, ASPECT)
    assert f.resolve_view("bogus") == "camera" and f.resolve_view("top") == "top"


def test_camera_view_keeps_artist_direction():
    hint = (0.0, -1.0, 0.2)
    assert close(f.plan_camera("camera", CUBE, ASPECT, direction_hint=hint)["direction"], f.normalize(hint))


def test_robust_union():
    floor = ((-25, -25, 0), (25, 25, 0))
    assert f.robust_union([("Floor", floor), ("Cube", CUBE)]) == (CUBE, ["Floor"])
    tower = ((-30, -30, 0), (30, 30, 40))
    assert f.robust_union([("Tower", tower), ("Cube", CUBE)])[1] == []          # solids never dropped
    bg, face = ((-4, .5, -4), (4, .5, 4)), ((-.8, .15, -.4), (.9, .15, 1.1))
    assert f.robust_union([("BG", bg), ("Face", face)]) == (face, ["BG"])        # layered 2.5D scene
    a, b = ((-1, 0, -1), (1, 0, 1)), ((2, 0, -1), (4, 0, 1))
    assert f.robust_union([("A", a), ("B", b)])[1] == []                         # similar flats kept
    assert f.robust_union([]) == (None, []) and f.robust_union([("O", CUBE)]) == (CUBE, [])


def square(x0, y0, x1, y1, depth=5.0):
    return [(x, y, depth) for x in (x0, x1) for y in (y0, y1)] * 2


@pytest.mark.parametrize("pts,ok,word", [
    (square(.2, .2, .8, .8), True, ""),
    (square(1.5, 1.5, 2.0, 2.0), False, "outside"),
    (square(-0.8, .2, 1.6, .8), False, "clipped"),
    (square(.48, .48, .52, .52), False, "tiny"),
    ([], False, "behind"),
    ([(.5, .5, -1.0)] + square(.2, .2, .8, .8)[1:], False, "behind"),
])
def test_camera_acceptance(pts, ok, word):
    got, reason = f.camera_is_acceptable(f.assess_projection(pts))
    assert got is ok and word in reason
