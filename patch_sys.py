import sys
content = open('prompts/system.md', 'r', encoding='utf-8').read()

old_code = '''     for block in bpy.data.meshes.list() + bpy.data.cameras.list() + bpy.data.lights.list() + bpy.data.materials.list():
         bpy.data.batch_remove([block])'''

new_code = '''     for block in list(bpy.data.meshes) + list(bpy.data.cameras) + list(bpy.data.lights) + list(bpy.data.materials):
         bpy.data.batch_remove([block])'''

content = content.replace(old_code, new_code)
open('prompts/system.md', 'w', encoding='utf-8').write(content)
