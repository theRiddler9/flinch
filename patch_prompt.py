content = open('prompts/system.md', 'r', encoding='utf-8').read()

old_mod = '''5. MODIFIERS:
   - To add a modifier: mod = obj.modifiers.new(name="Subsurf", type='SUBSURF')'''

new_mod = '''5. MODIFIERS:
   - To add a modifier: mod = obj.modifiers.new(name="Subsurf", type='SUBSURF')
   - CRITICAL: For subdivision, the property is mod.levels = 2 and mod.render_levels = 2. NEVER use mod.subdivisions (it does not exist and will crash!).'''

content = content.replace(old_mod, new_mod)

open('prompts/system.md', 'w', encoding='utf-8').write(content)
