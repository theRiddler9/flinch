import sys
content = open('apps/desktop/ui/src/components/Sidebar.tsx', 'r', encoding='utf-8').read()

old_header = '''      {/* Brand header */}
      <div className="px-4 py-3 border-b border-flinch-border-dim flex items-center gap-2.5 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-flinch-accent to-blue-600 flex items-center justify-center shadow-flinch-glow">
          <Box size={14} className="text-white" />
        </div>
        <div>
          <div className="text-sm font-bold tracking-tight text-flinch-text">Flinch</div>
          <div className="text-2xs text-flinch-text-muted">Cursor for Blender</div>
        </div>'''

new_header = '''      {/* Brand header */}
      <div className="px-4 py-3 border-b border-flinch-border-dim flex items-center gap-3 shrink-0 bg-black/20">
        <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] flex items-center justify-center shadow-[0_0_12px_rgba(139,92,246,0.4)] border border-white/10">
          <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent rounded-lg opacity-50" />
          <Box size={18} weight="duotone" className="text-white drop-shadow-md z-10" />
        </div>
        <div className="flex flex-col justify-center">
          <div className="text-[15px] font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-white/70 leading-tight">FLINCH</div>
          <div className="text-[10px] uppercase font-medium tracking-widest text-flinch-accent/90 leading-tight">Blender AI</div>
        </div>'''

content = content.replace(old_header, new_header)

open('apps/desktop/ui/src/components/Sidebar.tsx', 'w', encoding='utf-8').write(content)
