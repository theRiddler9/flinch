import sys
content = open('apps/desktop/ui/src/components/Sidebar.tsx', 'r', encoding='utf-8').read()

old_empty = '''            {history.length === 0 && (
              <div className="text-center py-6 text-flinch-text-muted text-xs">
                <div className="text-xl mb-1 opacity-30">??</div>
                No sessions yet
              </div>
            )}'''

new_empty = '''            {history.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-flinch-text-muted text-xs bg-flinch-surface/30 rounded-lg border border-flinch-border-dim/50 mx-2 mt-2 border-dashed">
                <Sparkles size={24} className="mb-2 opacity-40 text-flinch-accent" />
                <span className="font-medium text-flinch-text-dim">No sessions yet</span>
                <span className="opacity-70 mt-0.5 text-center px-4">Start generating to see your history here</span>
              </div>
            )}'''

content = content.replace(old_empty, new_empty)

open('apps/desktop/ui/src/components/Sidebar.tsx', 'w', encoding='utf-8').write(content)
