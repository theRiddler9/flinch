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
6. If you hit an `AttributeError` on Grease Pencil (e.g. `'GreasePencilFrame' object has no attribute 'strokes'`): Blender 5.2 uses Grease Pencil v3. In GPv3, strokes belong to `frame.drawing`: `drawing = frame.drawing; drawing.add_strokes([num_points]); stroke = drawing.strokes[0]; stroke.points[i].position = (x, y, z); stroke.points[i].radius = 0.05`.
7. If you hit `AttributeError: 'NoneType' object has no attribute 'stroke_color'` (or 'line_color', 'color', 'fill_color' on NoneType): this means you are accessing `mat.grease_pencil` BEFORE calling `bpy.data.materials.create_gpencil_data(mat)`. Also, `stroke_color` does NOT exist — the correct attribute is `mat.grease_pencil.color`. Fix pattern:
   ```python
   mat = bpy.data.materials.new("GPMat")
   bpy.data.materials.create_gpencil_data(mat)  # MUST be called FIRST
   mat.grease_pencil.color = (R, G, B, 1.0)     # use .color NOT .stroke_color
   mat.grease_pencil.fill_color = (R, G, B, 1.0)
   mat.grease_pencil.show_stroke = True
   ```
8. If you hit `KeyError: 'bpy_prop_collection[key]: key "..." not found'` on `bsdf.inputs[...]` (such as `"Specular"`, `"Transmission"`, `"Subsurface"`, `"Emission"`): In Blender 5.2 Principled BSDF, sockets were renamed! Use `bsdf.inputs['Specular IOR Level']` (NOT `'Specular'`), `bsdf.inputs['Transmission Weight']` (NOT `'Transmission'`), `bsdf.inputs['Subsurface Weight']` (NOT `'Subsurface'`), `bsdf.inputs['Emission Color']` (NOT `'Emission'`), `bsdf.inputs['Coat Weight']` (NOT `'Clearcoat'`).
9. If you hit `TypeError: Converting py args to operator properties` or enum errors: Check operator argument names (e.g. `bpy.ops.mesh.primitive_torus_add` uses `major_segments` and `minor_segments`, NOT `segments`) and mode enum (use `bpy.ops.object.mode_set(mode='OBJECT')`, NOT `mode='END'`).

Reply in the same two sections as before:

### 🛠️ Manual Blender Step-by-Step Modeling Guide
Keep the guide matching the model the fixed script builds. If the guide does not need to change, write only the single line `_Guide unchanged._` under this heading instead of repeating it.

### 🐍 Executable Blender Python (bpy) Script
Exactly ONE fenced `python` block with the FULL corrected script (never a partial diff), and nothing after its closing fence.
