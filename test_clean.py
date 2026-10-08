import bpy

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.meshes) + list(bpy.data.cameras) + list(bpy.data.lights) + list(bpy.data.materials):
    bpy.data.batch_remove([block])

print("SUCCESSFULLY CLEANED SCENE")
