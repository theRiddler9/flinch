import bpy
import math

# Clean scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.meshes) + list(bpy.data.cameras) + list(bpy.data.lights) + list(bpy.data.materials):
    bpy.data.batch_remove([block])

# Set timeline
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 120
bpy.context.scene.render.fps = 24

# Create red cube
bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
cube = bpy.context.active_object
cube.rotation_euler = (math.radians(0), math.radians(0), math.radians(0))
cube.scale = (1.0, 1.0, 1.0)

# Create red material for cube
mat_red = bpy.data.materials.new(name="RedCube")
mat_red.use_nodes = True
nodes = mat_red.node_tree.nodes
nodes.clear()
bsdf = nodes.new(type='ShaderNodeBsdfPrincipled')
bsdf.inputs['Base Color'].default_value = (1.0, 0.0, 0.0, 1.0)
out = nodes.new(type='ShaderNodeOutputMaterial')
mat_red.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
cube.data.materials.append(mat_red)

# Add subdivision modifier to cube
mod = cube.modifiers.new(name="Subsurf", type='SUBSURF')
mod.levels = 2
mod.render_levels = 2

# Create blue sphere
bpy.ops.mesh.primitive_uv_sphere_add(radius=1.5, location=(3, -2, 0))
sphere = bpy.context.active_object
sphere.rotation_euler = (math.radians(0), math.radians(0), math.radians(0))
sphere.scale = (1.0, 1.0, 1.0)

# Create blue material for sphere
mat_blue = bpy.data.materials.new(name="BlueSphere")
mat_blue.use_nodes = True
nodes = mat_blue.node_tree.nodes
nodes.clear()
bsdf = nodes.new(type='ShaderNodeBsdfPrincipled')
bsdf.inputs['Base Color'].default_value = (0.0, 0.5, 1.0, 1.0)
out = nodes.new(type='ShaderNodeOutputMaterial')
mat_blue.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
sphere.data.materials.append(mat_blue)

# Add subdivision modifier to sphere
mod = sphere.modifiers.new(name="Subsurf", type='SUBSURF')
mod.levels = 2
mod.render_levels = 2

# Create green cylinder
bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=3, location=(-3, 0, 0))
cyl = bpy.context.active_object
cyl.rotation_euler = (math.radians(0), math.radians(0), math.radians(0))
cyl.scale = (1.0, 1.0, 1.0)

# Create green material for cylinder
mat_green = bpy.data.materials.new(name="GreenCylinder")
mat_green.use_nodes = True
nodes = mat_green.node_tree.nodes
nodes.clear()
bsdf = nodes.new(type='ShaderNodeBsdfPrincipled')
bsdf.inputs['Base Color'].default_value = (0.0, 1.0, 0.0, 1.0)
out = nodes.new(type='ShaderNodeOutputMaterial')
mat_green.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
cyl.data.materials.append(mat_green)

# Add subdivision modifier to cylinder
mod = cyl.modifiers.new(name="Subsurf", type='SUBSURF')
mod.levels = 2
mod.render_levels = 2

# Create camera with rotation
bpy.ops.object.camera_add(location=(0, -10, 5), rotation=(math.radians(70), 0, 0))
cam = bpy.context.active_object
bpy.context.scene.camera = cam

# Create sun light
bpy.ops.object.light_add(type='SUN', location=(5, 5, 5), rotation=(0, math.radians(45), 0))
light = bpy.context.active_object
light.data.energy = 5.0

# Animate cube movement
cube.location = (0, 0, 5)
cube.keyframe_insert(data_path="location", frame=24)
cube.location = (0, 0, -5)
cube.keyframe_insert(data_path="location", frame=60)
cube.location = (0, 0, 5)
cube.keyframe_insert(data_path="location", frame=96)

# Set render settings
bpy.context.scene.render.engine = 'CYCLES'
bpy.context.scene.cycles.samples = 128
