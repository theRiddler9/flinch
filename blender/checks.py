import json
import bpy

def run_checks(spec_path, scene_stats):
    """
    Evaluates declarative checks defined in spec_path against scene_stats and current bpy state.
    Returns a list of check results: [{"id": "...", "passed": True, "detail": ""}]
    """
    try:
        with open(spec_path, 'r') as f:
            checks = json.load(f)
    except Exception as e:
        return [{"id": "load_checks", "passed": False, "detail": str(e)}]
        
    results = []
    
    for i, check in enumerate(checks):
        ctype = check.get("type")
        passed = False
        detail = ""
        
        try:
            if ctype == "object_count":
                obj_type = check.get("object_type")
                min_count = check.get("min", 1)
                
                count = sum(1 for obj in bpy.data.objects if obj.type == obj_type)
                passed = count >= min_count
                detail = f"Found {count}, expected {min_count}"
                
            elif ctype == "has_keyframes":
                data_path = check.get("data_path")
                min_keys = check.get("min_keyframes", 1)
                count = 0
                
                for action in bpy.data.actions:
                    for fcurve in action.fcurves:
                        if data_path in fcurve.data_path:
                            count += len(fcurve.keyframe_points)
                passed = count >= min_keys
                detail = f"Found {count} keys for {data_path}"
                
            elif ctype == "frame_range":
                min_length = check.get("min_length", 1)
                length = bpy.context.scene.frame_end - bpy.context.scene.frame_start
                passed = length >= min_length
                detail = f"Length {length}"
                
            elif ctype == "has_material":
                min_count = check.get("min", 1)
                count = len(bpy.data.materials)
                passed = count >= min_count
                detail = f"Found {count} materials"
                
            elif ctype == "has_modifier":
                mod_type = check.get("modifier_type")
                count = 0
                for obj in bpy.data.objects:
                    for mod in obj.modifiers:
                        if mod.type == mod_type:
                            count += 1
                passed = count > 0
                detail = f"Found {count} {mod_type} modifiers"
                
            elif ctype == "has_grease_pencil_strokes":
                min_count = check.get("min", 1)
                count = 0
                # v3 api Grease Pencil
                for gp in bpy.data.grease_pencils:
                    if hasattr(gp, 'layers'): # v2
                        for layer in gp.layers:
                            for frame in layer.frames:
                                count += len(frame.strokes)
                passed = count >= min_count
                detail = f"Found {count} strokes"
                
            elif ctype == "has_constraint":
                cons_type = check.get("constraint_type")
                count = 0
                for obj in bpy.data.objects:
                    for cons in obj.constraints:
                        if cons.type == cons_type:
                            count += 1
                passed = count > 0
                detail = f"Found {count} {cons_type} constraints"
                
            elif ctype == "has_shape_keys":
                min_count = check.get("min", 1)
                count = 0
                for mesh in bpy.data.meshes:
                    if mesh.shape_keys:
                        count += len(mesh.shape_keys.key_blocks)
                passed = count >= min_count
                detail = f"Found {count} shape keys"
                
            elif ctype == "has_driver":
                min_count = check.get("min", 1)
                count = 0
                if bpy.data.window_managers: # usually drivers are in data
                    pass # Drivers are somewhat hard to globally count easily without iterating everything.
                # basic check on objects
                for obj in bpy.data.objects:
                    if obj.animation_data and obj.animation_data.drivers:
                        count += len(obj.animation_data.drivers)
                passed = count >= min_count
                detail = f"Found {count} drivers"
            
            else:
                passed = False
                detail = f"Unknown check type {ctype}"
        except Exception as e:
            passed = False
            detail = f"Error evaluating check: {e}"
            
        results.append({
            "id": f"{ctype}_{i}",
            "passed": passed,
            "detail": detail
        })
        
    return results
