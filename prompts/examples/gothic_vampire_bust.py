import bpy
import math

# ---------- Clean Scene ----------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for col in [bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights]:
    for block in list(col):
        bpy.data.batch_remove([block])

bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 60
bpy.context.scene.render.fps = 24
bpy.context.scene.render.resolution_x = 800
bpy.context.scene.render.resolution_y = 900

# ---------- Material Helper (Toon / Cel Shaded) ----------
def create_toon_mat(name, rgba, roughness=0.3, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = rgba
    nodes = mat.node_tree.nodes
    nodes.clear()
    bsdf = nodes.new(type='ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Specular IOR Level'].default_value = 0.2
    out = nodes.new(type='ShaderNodeOutputMaterial')
    mat.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return mat

# Materials palette sampled from reference image
M_BG        = create_toon_mat("Mat_BG",        (0.24, 0.27, 0.29, 1.0), roughness=1.0)
M_SKIN      = create_toon_mat("Mat_Skin",      (0.85, 0.83, 0.86, 1.0), roughness=0.4)
M_SHADOW    = create_toon_mat("Mat_Shadow",    (0.55, 0.48, 0.52, 1.0), roughness=0.5)
M_NECK_SHAD = create_toon_mat("Mat_NeckShad",  (0.22, 0.23, 0.28, 1.0), roughness=0.5)
M_HAIR      = create_toon_mat("Mat_Hair",      (0.02, 0.02, 0.03, 1.0), roughness=0.25)
M_HAIR_HIL  = create_toon_mat("Mat_HairHil",   (0.38, 0.42, 0.48, 1.0), roughness=0.2)
M_BLACK     = create_toon_mat("Mat_Black",     (0.01, 0.01, 0.01, 1.0), roughness=0.3)
M_CLOTHES   = create_toon_mat("Mat_Clothes",   (0.04, 0.04, 0.05, 1.0), roughness=0.4)
M_EYE_WHITE = create_toon_mat("Mat_EyeWhite",  (0.96, 0.96, 0.98, 1.0), roughness=0.1)
M_IRIS      = create_toon_mat("Mat_Iris",      (0.58, 0.65, 0.78, 1.0), roughness=0.1)
M_PUPIL     = create_toon_mat("Mat_Pupil",     (0.08, 0.10, 0.14, 1.0), roughness=0.1)
M_MOUTH_IN  = create_toon_mat("Mat_MouthIn",   (0.12, 0.05, 0.09, 1.0), roughness=0.2)
M_TONGUE    = create_toon_mat("Mat_Tongue",    (0.78, 0.46, 0.52, 1.0), roughness=0.2)
M_FANG      = create_toon_mat("Mat_Fang",      (0.98, 0.98, 1.00, 1.0), roughness=0.1)
M_SILVER    = create_toon_mat("Mat_Silver",    (0.82, 0.85, 0.90, 1.0), roughness=0.1, metallic=0.9)
M_WHITE_DOT = create_toon_mat("Mat_WhiteDot",  (1.00, 1.00, 1.00, 1.0), roughness=0.0)

# ---------- Mesh Polygon Helper ----------
def create_poly(name, verts_2d, y_depth, mat):
    verts = [(x, y_depth, z) for (x, z) in verts_2d]
    faces = [list(range(len(verts)))]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj

# -------------------------------------------------------------
# 1. BACKGROUND (Y = 0.50)
# -------------------------------------------------------------
create_poly("Background", [(-4.0, -4.0), (4.0, -4.0), (4.0, 4.0), (-4.0, 4.0)], 0.50, M_BG)

# -------------------------------------------------------------
# 2. BACK HAIR (Y = 0.35)
# -------------------------------------------------------------
back_hair_outline = [
    (-2.2, -3.0), (-2.0, 0.0), (-1.6, 1.0), (-1.0, 1.8),
    (0.0, 2.0), (1.0, 1.8), (1.6, 1.0), (2.0, 0.0),
    (2.2, -3.0), (0.0, -3.0)
]
create_poly("BackHair", back_hair_outline, 0.35, M_HAIR)

# -------------------------------------------------------------
# 3. BODY & CLOTHES (Y = 0.25)
# -------------------------------------------------------------
clothes_outline = [
    (-2.2, -3.0), (-1.5, -0.9), (-0.45, -0.65), (0.45, -0.65),
    (1.5, -1.0), (2.2, -3.0), (0.0, -3.0)
]
create_poly("Clothes", clothes_outline, 0.25, M_CLOTHES)

# -------------------------------------------------------------
# 4. NECK & THROAT SHADOW (Y = 0.20)
# -------------------------------------------------------------
neck_outline = [
    (-0.30, -0.85), (-0.35, -0.15), (0.28, -0.10), (0.30, -0.85)
]
create_poly("Neck", neck_outline, 0.20, M_SKIN)

# Cast shadow under tilted chin
neck_shadow_outline = [
    (-0.35, -0.15), (-0.10, -0.42), (0.28, -0.10),
    (0.10, -0.26), (-0.20, -0.22)
]
create_poly("NeckShadow", neck_shadow_outline, 0.19, M_NECK_SHAD)

# Choker band (Y = 0.17)
choker_outline = [
    (-0.32, -0.75), (-0.32, -0.58), (0.30, -0.56), (0.30, -0.73)
]
create_poly("Choker", choker_outline, 0.17, M_BLACK)

# Choker silver ring detail (Y = 0.16)
choker_ring = [
    (-0.05, -0.68), (-0.05, -0.62), (0.03, -0.62), (0.03, -0.68)
]
create_poly("ChokerRing", choker_ring, 0.16, M_SILVER)

# -------------------------------------------------------------
# 5. FACE & EAR (Y = 0.15) - 3/4 Anime Silhouette
# -------------------------------------------------------------
face_outline = [
    (-0.85, 0.85),   # Left temple
    (-0.80, 0.35),   # Left cheekbone
    (-0.65, 0.05),   # Left mid jaw
    (-0.30, -0.18),  # Tapered jawline
    (-0.10, -0.38),  # Sharp pointed chin!
    (0.12, -0.22),   # Right jawline
    (0.48, 0.05),    # Right cheek curve
    (0.68, 0.25),    # Under ear
    (0.92, 0.48),    # Ear tip
    (0.80, 0.70),    # Ear top connection
    (0.65, 0.95),    # Right temple
    (0.00, 1.15),    # Top head
    (-0.55, 1.05)    # Top left head
]
create_poly("Face", face_outline, 0.15, M_SKIN)

# Ear inner shadow/fold (Y = 0.14)
ear_inner = [
    (0.70, 0.30), (0.86, 0.44), (0.78, 0.58), (0.68, 0.44)
]
create_poly("EarShadow", ear_inner, 0.14, M_SHADOW)

# Ear Piercings (Y = 0.13)
# 2 Helix silver rings
create_poly("PiercingRing1", [(0.76, 0.65), (0.83, 0.68), (0.81, 0.62)], 0.13, M_SILVER)
create_poly("PiercingRing2", [(0.83, 0.58), (0.90, 0.60), (0.87, 0.54)], 0.13, M_SILVER)
# 3 Lobe metallic studs
create_poly("PiercingStud1", [(0.89, 0.44), (0.92, 0.44), (0.92, 0.41), (0.89, 0.41)], 0.13, M_SILVER)
create_poly("PiercingStud2", [(0.82, 0.35), (0.85, 0.35), (0.85, 0.32), (0.82, 0.32)], 0.13, M_SILVER)
create_poly("PiercingStud3", [(0.74, 0.26), (0.77, 0.26), (0.77, 0.23), (0.74, 0.23)], 0.13, M_SILVER)

# -------------------------------------------------------------
# 6. FACIAL FEATURES (Y = 0.10 - 0.06)
# -------------------------------------------------------------
# --- Left Eye ---
create_poly("EyeL_White", [
    (-0.64, 0.45), (-0.46, 0.54), (-0.30, 0.46), (-0.46, 0.40)
], 0.10, M_EYE_WHITE)

create_poly("EyeL_Iris", [
    (-0.52, 0.49), (-0.40, 0.51), (-0.36, 0.45), (-0.47, 0.42)
], 0.09, M_IRIS)

create_poly("EyeL_Pupil", [
    (-0.46, 0.48), (-0.41, 0.49), (-0.39, 0.45), (-0.44, 0.44)
], 0.08, M_PUPIL)

# Thick upper winged eyeliner left
create_poly("EyeL_Liner", [
    (-0.68, 0.43), (-0.64, 0.50), (-0.44, 0.59), (-0.26, 0.48),
    (-0.30, 0.45), (-0.45, 0.53), (-0.62, 0.45)
], 0.07, M_BLACK)

# --- Right Eye (large cat-eye winged anime shape) ---
create_poly("EyeR_White", [
    (-0.06, 0.50), (0.16, 0.61), (0.44, 0.54), (0.48, 0.50),
    (0.24, 0.44), (0.04, 0.46)
], 0.10, M_EYE_WHITE)

create_poly("EyeR_Iris", [
    (0.08, 0.56), (0.23, 0.60), (0.31, 0.53), (0.24, 0.47), (0.11, 0.48)
], 0.09, M_IRIS)

create_poly("EyeR_Pupil", [
    (0.16, 0.54), (0.23, 0.55), (0.23, 0.49), (0.16, 0.49)
], 0.08, M_PUPIL)

# White catchlight shine
create_poly("EyeR_Shine", [
    (0.24, 0.57), (0.28, 0.57), (0.28, 0.53), (0.24, 0.53)
], 0.07, M_WHITE_DOT)

# Heavy cat-eye winged upper eyeliner right
create_poly("EyeR_WingLiner", [
    (-0.14, 0.48), (0.12, 0.67), (0.38, 0.63), (0.58, 0.60), (0.64, 0.68), # wing flick
    (0.55, 0.56), (0.36, 0.57), (0.14, 0.59), (-0.08, 0.47)
], 0.06, M_BLACK)

# Lower thin eyeliner right
create_poly("EyeR_LowerLiner", [
    (0.04, 0.45), (0.24, 0.43), (0.46, 0.50), (0.43, 0.52), (0.24, 0.46), (0.06, 0.47)
], 0.06, M_BLACK)

# Beauty mark (mole) below outer right eye corner
create_poly("BeautyMark", [
    (0.40, 0.38), (0.43, 0.38), (0.43, 0.35), (0.40, 0.35)
], 0.06, M_BLACK)

# Eyebrows
create_poly("EyebrowL", [
    (-0.62, 0.72), (-0.46, 0.79), (-0.30, 0.74), (-0.46, 0.76)
], 0.06, M_BLACK)

create_poly("EyebrowR", [
    (-0.04, 0.76), (0.22, 0.84), (0.46, 0.79), (0.22, 0.81)
], 0.06, M_BLACK)

# Cute anime nose contour
create_poly("Nose", [
    (-0.16, 0.24), (-0.14, 0.12), (-0.07, 0.10), (-0.11, 0.12), (-0.15, 0.20)
], 0.06, M_BLACK)

# -------------------------------------------------------------
# 7. MOUTH: SMIRK, VAMPIRE FANGS & TONGUE (Y = 0.08 - 0.04)
# -------------------------------------------------------------
# Dark mouth cavity interior (Y = 0.08)
create_poly("MouthInterior", [
    (-0.46, -0.02), (-0.12, 0.05), (0.22, -0.05),
    (0.08, -0.28), (-0.24, -0.24)
], 0.08, M_MOUTH_IN)

# Upper Lip with black lipstick (Y = 0.06)
create_poly("UpperLip", [
    (-0.50, -0.02), (-0.28, 0.07), (-0.08, 0.09), (0.10, 0.03), (0.26, -0.05),
    (0.18, -0.01), (-0.08, 0.03), (-0.28, 0.02), (-0.44, -0.04)
], 0.06, M_BLACK)

# Vampire Fang Left (sharp white cone pointing down)
create_poly("FangL", [
    (-0.34, 0.02), (-0.29, -0.14), (-0.23, 0.02)
], 0.05, M_FANG)

# Vampire Fang Right (sharp white cone pointing down)
create_poly("FangR", [
    (0.00, 0.01), (0.06, -0.16), (0.12, -0.01)
], 0.05, M_FANG)

# Playful Pink Tongue sticking out between fangs (Y = 0.04)
create_poly("Tongue", [
    (-0.22, -0.02), (-0.15, -0.20), (-0.18, -0.38), (-0.09, -0.45),
    (0.02, -0.36), (0.02, -0.16), (-0.02, -0.02)
], 0.04, M_TONGUE)

# Tongue midline shadow groove (Y = 0.035)
create_poly("TongueCrease", [
    (-0.11, -0.10), (-0.10, -0.36), (-0.08, -0.36), (-0.09, -0.10)
], 0.035, M_SHADOW)

# Lower lip black contour under tongue
create_poly("LowerLipOutline", [
    (-0.30, -0.24), (-0.08, -0.30), (0.12, -0.26),
    (0.10, -0.29), (-0.08, -0.33), (-0.28, -0.26)
], 0.05, M_BLACK)

# -------------------------------------------------------------
# 8. FRONT HAIR: BLUNT BANGS & SIDE LOCKS (Y = 0.00 to -0.04)
# -------------------------------------------------------------
# Straight horizontal blunt bangs across forehead right above the eyes
bangs_shape = [
    (-0.85, 1.20), (0.75, 1.20), (0.75, 0.85),
    (0.60, 0.68), (0.54, 0.72),
    (0.44, 0.66), (0.38, 0.71),
    (0.24, 0.67), (0.16, 0.72),
    (0.04, 0.68), (-0.04, 0.72),
    (-0.18, 0.66), (-0.25, 0.71),
    (-0.38, 0.67), (-0.46, 0.72),
    (-0.60, 0.65), (-0.68, 0.70),
    (-0.82, 0.68)
]
create_poly("FrontBangs", bangs_shape, 0.00, M_HAIR)

# Cool slate-grey highlight sheen arc across bangs (Y = -0.01)
hair_sheen = [
    (-0.65, 0.85), (-0.25, 0.90), (0.20, 0.88), (0.55, 0.83),
    (0.53, 0.79), (0.18, 0.83), (-0.25, 0.85), (-0.63, 0.81)
]
create_poly("HairHighlight", hair_sheen, -0.01, M_HAIR_HIL)

# Left framing long hair lock (Y = -0.02)
lock_left = [
    (-0.75, 1.05), (-0.98, 0.35), (-0.95, -0.60), (-0.80, -2.20),
    (-0.64, -2.20), (-0.72, -0.50), (-0.74, 0.40)
]
create_poly("SideLockL", lock_left, -0.02, M_HAIR)

# Single wispy hair strand falling across left cheek (Y = -0.03)
strand_cheek = [
    (-0.62, 0.68), (-0.56, 0.20), (-0.54, -0.15),
    (-0.52, -0.15), (-0.53, 0.20), (-0.60, 0.68)
]
create_poly("CheekStrand", strand_cheek, -0.03, M_HAIR)

# Right framing side lock between cheek and ear (Y = -0.02)
lock_right = [
    (0.38, 0.78), (0.48, 0.15), (0.45, -0.80), (0.38, -2.00),
    (0.26, -2.00), (0.34, -0.70), (0.32, 0.10)
]
create_poly("SideLockR", lock_right, -0.02, M_HAIR)

# Additional hair strand in front of ear (Y = -0.02)
lock_ear_front = [
    (0.60, 0.85), (0.80, 0.05), (0.85, -1.50),
    (0.72, -1.50), (0.68, 0.05)
]
create_poly("SideLockEar", lock_ear_front, -0.02, M_HAIR)

# -------------------------------------------------------------
# 9. CAMERA & LIGHTING (Framed portrait)
# -------------------------------------------------------------
bpy.ops.object.camera_add(location=(0.0, -5.2, 0.15), rotation=(math.radians(90), 0, 0))
cam = bpy.context.active_object
cam.data.lens = 55
bpy.context.scene.camera = cam

# Key light
bpy.ops.object.light_add(type='SUN', location=(1.0, -4.0, 3.0), rotation=(math.radians(-30), math.radians(15), 0))
key_sun = bpy.context.active_object
key_sun.data.energy = 4.0

# Soft fill
bpy.ops.object.light_add(type='AREA', location=(-2.0, -3.0, 1.0))
fill = bpy.context.active_object
fill.data.energy = 100.0

print("Gothic anime vampire girl model created successfully.")
