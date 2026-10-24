"""Pure-Python camera framing math for Flinch previews (no bpy). Vectors are (x, y, z) tuples,
boxes are (min, max). World is Z-up; cameras look down local -Z. `direction` = target -> camera."""
import math

VIEWS = ("camera", "front", "side", "top", "iso")
ORTHO_VIEWS = ("front", "side", "top")
FRAME_PADDING = 0.15          # subject fills at most 1/(1+padding) of the frame
ISO_AZIMUTH_DEG = 45.0
ISO_ELEVATION_DEG = 45.0
DEFAULT_SENSOR_WIDTH = 36.0
MIN_LENS, MAX_LENS = 24.0, 120.0
PREFERRED_DISTANCE_FACTOR = 3.2
MIN_VISIBLE_RATIO = 0.6       # share of the subject's projected area that must be in frame
MIN_SUBJECT_FILL = 0.12       # below this the subject counts as "tiny"


def add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def mul(a, s): return (a[0] * s, a[1] * s, a[2] * s)
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def length(a): return math.sqrt(dot(a, a))


def normalize(a, fallback=(0.0, 0.0, 1.0)):
    n = length(a)
    return fallback if n < 1e-12 else (a[0] / n, a[1] / n, a[2] / n)


def box_from_points(points):
    pts = list(points)
    if not pts:
        return None
    return (tuple(min(p[i] for p in pts) for i in range(3)), tuple(max(p[i] for p in pts) for i in range(3)))


def union_boxes(boxes):
    boxes = [b for b in boxes if b is not None]
    return box_from_points([b[0] for b in boxes] + [b[1] for b in boxes]) if boxes else None


def box_center(box): return mul(add(box[0], box[1]), 0.5)
def box_size(box): return sub(box[1], box[0])
def box_diagonal(box): return length(box_size(box))
def box_radius(box): return max(box_diagonal(box) / 2.0, 1e-6)


def box_corners(box):
    (x0, y0, z0), (x1, y1, z1) = box
    return [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]


def inflate_box(box, half):
    return (tuple(c - half for c in box[0]), tuple(c + half for c in box[1]))


def is_flat(box, ratio=0.02):
    size = box_size(box)
    return max(size) > 1e-9 and min(size) <= ratio * max(size)


def _median(values):
    v = sorted(values)
    n = len(v)
    return 0.0 if n == 0 else (v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2.0)


def robust_union(named_boxes, backdrop_factor=2.5):
    """Union of object boxes ignoring oversized flat backdrops (floors, background cards).
    Returns (box, dropped_names); if dropping would leave nothing, everything is kept."""
    items = [(n, b) for n, b in named_boxes if b is not None]
    if not items:
        return None, []
    if len(items) == 1:
        return items[0][1], []
    dropped, kept = [], []
    for i, (name, box) in enumerate(items):
        others = [box_diagonal(b) for j, (_, b) in enumerate(items) if j != i]
        if is_flat(box) and box_diagonal(box) > backdrop_factor * _median(others):
            dropped.append(name)
        else:
            kept.append(box)
    if not kept:
        return union_boxes([b for _, b in items]), []
    return union_boxes(kept), dropped


def view_direction(view, fallback=None):
    if view == "front": return (0.0, -1.0, 0.0)       # camera at -Y looking +Y
    if view == "side": return (1.0, 0.0, 0.0)         # Blender "Right": camera at +X
    if view == "top": return (0.0, 0.0, 1.0)
    if view in ("iso", "camera"):
        if view == "camera" and fallback is not None:
            return normalize(fallback)
        az, el = math.radians(ISO_AZIMUTH_DEG), math.radians(ISO_ELEVATION_DEG)
        return normalize((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    raise ValueError(f"Unknown view preset: {view!r}")


def camera_basis(direction):
    """(right, up, back) camera axes in world space; `back` is the camera's local +Z."""
    back = normalize(direction)
    right = cross(mul(back, -1.0), (0.0, 0.0, 1.0))
    if length(right) < 1e-6:
        right = (1.0, 0.0, 0.0)   # straight up/down: like Blender's Top view
    right = normalize(right)
    return right, cross(back, right), back


def basis_to_euler_xyz(right, up, back):
    """Blender XYZ Euler (R = Rz(c) Ry(b) Rx(a)); matrix columns are the camera axes."""
    b = math.asin(max(-1.0, min(1.0, -right[2])))
    if abs(math.cos(b)) > 1e-6:
        return (math.atan2(up[2], back[2]), b, math.atan2(right[1], right[0]))
    return (math.atan2(-back[1], up[1]), b, 0.0)


def fov_tangents(lens, sensor_width, aspect):
    """Half-FOV tangents (x, y) for sensor-fit AUTO (sensor width spans the larger side)."""
    t = sensor_width / (2.0 * lens)
    return (t, t / aspect) if aspect >= 1.0 else (t * aspect, t)


def choose_focal_length(radius, aspect, padding=FRAME_PADDING, sensor_width=DEFAULT_SENSOR_WIDTH,
                        distance_factor=PREFERRED_DISTANCE_FACTOR):
    """Lens that fits the bounding sphere at a natural distance (scale-invariant, clamped)."""
    if radius <= 0:
        return 50.0
    tan_big = (1.0 + padding) / distance_factor * (aspect if aspect >= 1.0 else 1.0 / aspect)
    return max(MIN_LENS, min(MAX_LENS, sensor_width / (2.0 * tan_big)))


def fit_perspective_distance(points, center, direction, tan_x, tan_y, padding=FRAME_PADDING):
    right, up, back = camera_basis(direction)
    k, need = 1.0 + padding, 1e-3
    for p in points:
        rel = sub(p, center)
        x, y, z = dot(rel, right), dot(rel, up), dot(rel, back)
        need = max(need, z + abs(x) * k / tan_x, z + abs(y) * k / tan_y)
    return need


def fit_ortho_scale(points, center, direction, aspect, padding=FRAME_PADDING):
    """(ortho_scale, (min_depth, max_depth)); ortho_scale spans the larger render dimension."""
    right, up, back = camera_basis(direction)
    k, mx, my, z0, z1 = 1.0 + padding, 1e-6, 1e-6, 0.0, 0.0
    for p in points:
        rel = sub(p, center)
        mx, my = max(mx, abs(dot(rel, right))), max(my, abs(dot(rel, up)))
        z = dot(rel, back)
        z0, z1 = min(z0, z), max(z1, z)
    w, h = 2 * mx * k, 2 * my * k
    return (max(w, h * aspect) if aspect >= 1.0 else max(w / aspect, h)), (z0, z1)


def plan_camera(view, box, aspect, sensor_width=DEFAULT_SENSOR_WIDTH, padding=FRAME_PADDING,
                direction_hint=None):
    """Camera plan framing `box`: dict(ortho, location, rotation, target, direction, lens,
    ortho_scale, clip_start, clip_end, distance)."""
    if view not in VIEWS:
        raise ValueError(f"Unknown view preset: {view!r}")
    if box is None:
        box = ((-2.0, -2.0, -2.0), (2.0, 2.0, 2.0))
    if box_diagonal(box) < 1e-3:
        box = inflate_box(box, 0.5)
    center, radius, points = box_center(box), box_radius(box), box_corners(box)
    direction = view_direction(view, fallback=direction_hint)
    right, up, back = camera_basis(direction)
    plan = {"ortho": view in ORTHO_VIEWS, "target": center, "direction": direction,
            "lens": 50.0, "ortho_scale": 1.0}
    if plan["ortho"]:
        scale, (z0, z1) = fit_ortho_scale(points, center, direction, aspect, padding)
        distance = max(radius * 2.0, z1 + radius)
        plan.update(ortho_scale=scale, clip_start=1e-3, clip_end=distance + (z1 - z0) + radius * 4.0 + 10.0)
    else:
        lens = choose_focal_length(radius, aspect, padding, sensor_width)
        tx, ty = fov_tangents(lens, sensor_width, aspect)
        distance = fit_perspective_distance(points, center, direction, tx, ty, padding)
        plan.update(lens=lens, clip_start=max(distance / 1000.0, 0.01), clip_end=max(100.0, distance + radius * 4.0))
    plan["distance"] = distance
    plan["location"] = add(center, mul(direction, distance))
    plan["rotation"] = basis_to_euler_xyz(right, up, back)
    return plan


def assess_projection(projected):
    """Judge a subject in an existing camera. `projected`: 8 corners as (x01, y01, depth) like
    bpy_extras world_to_camera_view. Returns behind / center_visible / visible_ratio / fill."""
    pts = list(projected)
    if not pts:
        return {"behind": True, "center_visible": False, "visible_ratio": 0.0, "fill": 0.0}
    behind = any(p[2] <= 0.0 for p in pts)
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    w, h = max(x1 - x0, 1e-9), max(y1 - y0, 1e-9)
    ix, iy = max(0.0, min(x1, 1.0) - max(x0, 0.0)), max(0.0, min(y1, 1.0) - max(y0, 0.0))
    return {"behind": behind,
            "center_visible": (not behind) and 0.0 <= cx <= 1.0 and 0.0 <= cy <= 1.0,
            "visible_ratio": 0.0 if behind else (ix * iy) / (w * h),
            "fill": max(w, h)}


def camera_is_acceptable(a):
    """(ok, reason): keep the scene's own camera or reframe?"""
    if a["behind"]: return False, "part of the scene is behind the camera"
    if not a["center_visible"]: return False, "the subject is outside the camera view"
    if a["visible_ratio"] < MIN_VISIBLE_RATIO: return False, "the subject is clipped by the camera frame"
    if a["fill"] < MIN_SUBJECT_FILL: return False, "the subject is tiny in the frame"
    return True, ""


def resolve_view(view):
    return view if view in VIEWS else "camera"
