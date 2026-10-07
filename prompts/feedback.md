The previous script failed to execute properly in Blender.

Failed at stage: {stage}

Error Traceback:
{error}

Stdout tail:
{stdout}

The failing script was:
```python
{script}
```

CRITICAL REMINDERS TO FIX THE ERROR:
1. If you hit an `AttributeError` on a material (e.g. `base_color_rgb`), remember: use `mat.diffuse_color = (R, G, B, A)` or `node.inputs['Base Color'].default_value = (R, G, B, A)`.
2. If you hit a `ValueError` on dimensions, remember: Colors are 4 values (RGBA). Coordinates (`location`, `rotation_euler`, `scale`) are EXACTLY 3 values `(x, y, z)`.
3. If you hit an `AttributeError` on an object from `bpy.ops`, remember: `bpy.ops` returns `{'FINISHED'}`, NOT the object. Use `bpy.context.active_object`.
4. If you hit context/poll errors, prefer using `bpy.data` API over `bpy.ops` API.
5. Make sure to `import bpy` and `import math`.

Please fix the error and output the FULL corrected script in a single fenced `python` block. NO markdown commentary.
