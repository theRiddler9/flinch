import bpy
import math

# --- Purge scene ---
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for col in [bpy.data.grease_pencils, bpy.data.cameras, bpy.data.lights, bpy.data.materials, bpy.data.meshes]:
    for item in list(col):
        bpy.data.batch_remove([item])

bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 48
bpy.context.scene.render.fps = 24

# --- Helper: create a GPv3 material with correct API ---
def make_gp_mat(name, stroke_rgba, fill_rgba=None, show_fill=False):
    mat = bpy.data.materials.new(name)
    bpy.data.materials.create_gpencil_data(mat)  # MUST call before accessing mat.grease_pencil
    mat.grease_pencil.color = stroke_rgba         # .color NOT .stroke_color
    mat.grease_pencil.fill_color = fill_rgba if fill_rgba else (0, 0, 0, 0)
    mat.grease_pencil.show_stroke = True
    mat.grease_pencil.show_fill = show_fill
    return mat

# --- Create Grease Pencil object ---
gp_data = bpy.data.grease_pencils.new("VampireGirl")
gp_obj = bpy.data.objects.new("VampireGirl", gp_data)
bpy.context.scene.collection.objects.link(gp_obj)

# --- Materials ---
mat_black   = make_gp_mat("Black",   (0.02, 0.02, 0.02, 1.0))
mat_skin    = make_gp_mat("Skin",    (0.05, 0.05, 0.05, 1.0), (0.92, 0.88, 0.85, 1.0), show_fill=True)
mat_hair    = make_gp_mat("Hair",    (0.02, 0.02, 0.02, 1.0), (0.04, 0.04, 0.05, 1.0), show_fill=True)
mat_eye     = make_gp_mat("Eye",     (0.05, 0.05, 0.08, 1.0), (0.72, 0.82, 0.95, 1.0), show_fill=True)
mat_tongue  = make_gp_mat("Tongue",  (0.4,  0.08, 0.08, 1.0), (0.88, 0.35, 0.35, 1.0), show_fill=True)
mat_fang    = make_gp_mat("Fang",    (0.05, 0.05, 0.05, 1.0), (0.98, 0.97, 0.96, 1.0), show_fill=True)
mat_liner   = make_gp_mat("Liner",   (0.0,  0.0,  0.0,  1.0), (0.0,  0.0,  0.0,  1.0), show_fill=True)

for m in [mat_black, mat_skin, mat_hair, mat_eye, mat_tongue, mat_fang, mat_liner]:
    gp_obj.data.materials.append(m)

IDX_BLACK  = 0
IDX_SKIN   = 1
IDX_HAIR   = 2
IDX_EYE    = 3
IDX_TONGUE = 4
IDX_FANG   = 5
IDX_LINER  = 6

# --- Helper: add a stroke to a layer/frame drawing ---
def add_stroke(drawing, pts, radius=0.04, mat_idx=0, cyclic=False):
    n = len(pts)
    drawing.add_strokes([n])
    s = drawing.strokes[-1]
    for i, (x, y, z) in enumerate(pts):
        s.points[i].position = (x, 0.0, z)
        s.points[i].radius   = radius
    s.material_index = mat_idx
    s.cyclic = cyclic
    return s

# --- Single layer/frame for the illustration ---
layer = gp_data.layers.new("Illustration")
frame = layer.frames.new(1)
d     = frame.drawing

# Face outline (oval)
face_pts = [(math.cos(t)*0.7, 0, math.sin(t)*0.9) for t in [i*2*math.pi/32 for i in range(32)]]
add_stroke(d, face_pts, 0.05, IDX_SKIN, cyclic=True)

# Left eye white
eye_l = [(math.cos(t)*0.16+(-0.25), 0, math.sin(t)*0.09+0.18) for t in [i*2*math.pi/16 for i in range(16)]]
add_stroke(d, eye_l, 0.03, IDX_EYE, cyclic=True)

# Right eye white
eye_r = [(math.cos(t)*0.16+(0.25), 0, math.sin(t)*0.09+0.18) for t in [i*2*math.pi/16 for i in range(16)]]
add_stroke(d, eye_r, 0.03, IDX_EYE, cyclic=True)

# Left eyebrow (winged liner)
add_stroke(d, [(-0.42, 0, 0.32), (-0.28, 0, 0.30), (-0.10, 0, 0.34)], 0.025, IDX_LINER)
# Right eyebrow
add_stroke(d, [(0.10, 0, 0.34), (0.28, 0, 0.30), (0.42, 0, 0.32)], 0.025, IDX_LINER)

# Left heavy eyeliner top lid
add_stroke(d, [(-0.41, 0, 0.23), (-0.25, 0, 0.28), (-0.09, 0, 0.23)], 0.02, IDX_LINER)
# Right eyeliner top lid
add_stroke(d, [(0.09, 0, 0.23), (0.25, 0, 0.28), (0.41, 0, 0.23)], 0.02, IDX_LINER)

# Nose hint
add_stroke(d, [(0.0, 0, -0.04), (-0.04, 0, -0.10), (0.04, 0, -0.10)], 0.02, IDX_BLACK)

# Open smirk mouth outline
mouth_pts = [(-0.30,0,-0.28),(-0.18,0,-0.32),(-0.05,0,-0.34),(0.05,0,-0.34),(0.18,0,-0.32),(0.30,0,-0.28),(0.22,0,-0.20),(0.0,0,-0.15),(-0.22,0,-0.20)]
add_stroke(d, mouth_pts, 0.03, IDX_BLACK, cyclic=True)

# Tongue
tongue_pts = [(-0.12,0,-0.32),(0.0,0,-0.52),(0.12,0,-0.32),(0.0,0,-0.30)]
add_stroke(d, tongue_pts, 0.03, IDX_TONGUE, cyclic=True)

# Left fang
add_stroke(d, [(-0.10,0,-0.28),(-0.12,0,-0.45),(-0.06,0,-0.28)], 0.03, IDX_FANG, cyclic=True)
# Right fang
add_stroke(d, [(0.06,0,-0.28),(0.12,0,-0.45),(0.10,0,-0.28)], 0.03, IDX_FANG, cyclic=True)

# Black lipstick on upper lip
add_stroke(d, [(-0.30,0,-0.28),(-0.18,0,-0.24),(-0.05,0,-0.26),(0.0,0,-0.24),(0.05,0,-0.26),(0.18,0,-0.24),(0.30,0,-0.28)], 0.035, IDX_LINER)

# Hair (long black hair shape, left side)
hair_l = [(-0.71,0,0.95),(-0.92,0,0.60),(-0.95,0,0.0),(-0.92,0,-0.60),(-0.82,0,-1.30),(-0.50,0,-1.60),(-0.38,0,-0.90),(-0.65,0,0.0),(-0.70,0,0.80)]
add_stroke(d, hair_l, 0.06, IDX_HAIR, cyclic=True)

# Hair right side
hair_r = [(0.71,0,0.95),(0.92,0,0.60),(0.95,0,0.0),(0.92,0,-0.60),(0.82,0,-1.30),(0.50,0,-1.60),(0.38,0,-0.90),(0.65,0,0.0),(0.70,0,0.80)]
add_stroke(d, hair_r, 0.06, IDX_HAIR, cyclic=True)

# Bangs (straight horizontal fringe)
for i in range(7):
    bx = -0.60 + i * 0.20
    add_stroke(d, [(bx, 0, 0.72), (bx - 0.04, 0, 0.40)], 0.05, IDX_HAIR)

# Beauty mark (small dot under left eye)
dot = [(math.cos(t)*0.025+(-0.32), 0, math.sin(t)*0.025+0.05) for t in [i*2*math.pi/8 for i in range(8)]]
add_stroke(d, dot, 0.02, IDX_LINER, cyclic=True)

# Choker
choker = [(math.cos(t)*0.50, 0, math.sin(t)*0.07+(-0.78)) for t in [i*math.pi/24 for i in range(25)]]
add_stroke(d, choker, 0.04, IDX_BLACK)

# Neck / shoulders
add_stroke(d, [(-0.18,0,-0.70),(-0.18,0,-0.88),(-0.50,0,-1.0),(-0.90,0,-1.08)], 0.04, IDX_SKIN)
add_stroke(d, [(0.18,0,-0.70),(0.18,0,-0.88),(0.50,0,-1.0),(0.90,0,-1.08)], 0.04, IDX_SKIN)

# --- Camera (portrait, looking at XZ plane) ---
bpy.ops.object.camera_add(location=(0, -5.0, 0), rotation=(math.radians(90), 0, 0))
cam = bpy.context.active_object
cam.data.lens = 60
bpy.context.scene.camera = cam

# --- Background plane ---
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0.1, 0), rotation=(math.radians(90), 0, 0))
bg = bpy.context.active_object
bg_mat = bpy.data.materials.new("Background")
bg_mat.use_nodes = True
bg_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.12, 0.12, 0.15, 1.0)
bg.data.materials.append(bg_mat)

# --- Light ---
bpy.ops.object.light_add(type='SUN', location=(2, -3, 4))
sun = bpy.context.active_object
sun.data.energy = 3.0
