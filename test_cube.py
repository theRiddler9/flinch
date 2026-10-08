import bpy

bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
cube = bpy.context.active_object
mat = bpy.data.materials.new(name="RedNode")
mat.use_nodes = True
mat.diffuse_color = (1.0, 0.0, 0.0, 1.0)
nodes = mat.node_tree.nodes
nodes.clear()
bsdf = nodes.new(type='ShaderNodeBsdfPrincipled')
bsdf.inputs['Base Color'].default_value = (1.0, 0.0, 0.0, 1.0)
out = nodes.new(type='ShaderNodeOutputMaterial')
mat.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
cube.data.materials.append(mat)
