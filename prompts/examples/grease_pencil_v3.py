import bpy
import math

# Purge scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.grease_pencils) + list(bpy.data.cameras) + list(bpy.data.lights) + list(bpy.data.materials):
    bpy.data.batch_remove([block])

# Timeline
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 48
bpy.context.scene.render.fps = 24

# 1. Create Grease Pencil v3 Object (Blender 4.3+ / 5.2)
gp_data = bpy.data.grease_pencils.new("GreasePencil")
gp_obj = bpy.data.objects.new("GreasePencil", gp_data)
bpy.context.scene.collection.objects.link(gp_obj)

# 2. Add layer and frame
layer = gp_data.layers.new("Lines")
frame = layer.frames.new(1)
drawing = frame.drawing

# 3. Add stroke: drawing.add_strokes([num_points])
num_points = 32
drawing.add_strokes([num_points])
stroke = drawing.strokes[0]

# Draw a circle
radius = 1.5
for i in range(num_points):
    theta = 2.0 * math.pi * (i / num_points)
    x = radius * math.cos(theta)
    z = radius * math.sin(theta)
    stroke.points[i].position = (x, 0.0, z)
    stroke.points[i].radius = 0.08

stroke.cyclic = True

# 4. Material
mat = bpy.data.materials.new("GPMaterial")
bpy.data.materials.create_gpencil_data(mat)
mat.grease_pencil.color = (0.1, 0.7, 1.0, 1.0)
gp_obj.data.materials.append(mat)
stroke.material_index = 0

# 5. Camera & Light
bpy.ops.object.camera_add(location=(0, -6, 0), rotation=(math.radians(90), 0, 0))
cam = bpy.context.active_object
bpy.context.scene.camera = cam

bpy.ops.object.light_add(type='SUN', location=(2, -3, 4), rotation=(0, math.radians(45), 0))
