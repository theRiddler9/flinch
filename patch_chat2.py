import sys
content = open('apps/desktop/ui/src/components/ChatPanel.tsx', 'r', encoding='utf-8').read()

# Fix imports
content = content.replace(
  "import { PaperPlaneRight as Send, Stop as Square, TerminalWindow as Terminal, SpinnerGap as Loader2 } from '@phosphor-icons/react';",
  "import { PaperPlaneRight as Send, Stop as Square, TerminalWindow as Terminal, SpinnerGap as Loader2, User, Robot, Sparkle as Sparkles } from '@phosphor-icons/react';"
)

# Empty state
old_empty = '''        {messages.length === 0 && !isRunning && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-5xl mb-4 opacity-30">??</div>
            <div className="text-flinch-text-dim text-sm font-medium mb-1">
              Describe your animation
            </div>
            <div className="text-flinch-text-muted text-xs max-w-[240px]">
              e.g. &ldquo;A red cube bouncing 3 times over 2 seconds at 24fps&rdquo;
            </div>
          </div>
        )}'''

new_empty = '''        {messages.length === 0 && !isRunning && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-flinch-accent/20 to-blue-500/10 flex items-center justify-center mb-4 border border-flinch-accent/20 shadow-[0_0_20px_rgba(59,130,246,0.1)]">
              <Sparkles size={28} className="text-flinch-accent" weight="duotone" />
            </div>
            <div className="text-flinch-text text-base font-semibold mb-2">
              What should we build?
            </div>
            <div className="text-flinch-text-muted text-xs max-w-[240px] leading-relaxed">
              Describe a 3D scene or animation, e.g. <br />
              <span className="italic opacity-80">&ldquo;A red cube bouncing 3 times over 2 seconds at 24fps&rdquo;</span>
            </div>
          </div>
        )}'''
content = content.replace(old_empty, new_empty)

# Messages
old_msg = '''          <div
            key={msg.id}
            className={cn(
              "flinch-slide-in rounded-lg text-[13px] leading-relaxed",
              msg.role === 'user'
                ? "ml-8 p-3 bg-flinch-accent/10 text-flinch-text border border-flinch-accent/15"
                : "mr-4 p-3 bg-flinch-surface/60 text-flinch-text-dim border border-flinch-border-dim"
            )}
            style={{ animationDelay: ${i * 20}ms }}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={cn(
                "text-2xs font-bold uppercase tracking-widest",
                msg.role === 'user' ? "text-flinch-accent" : "text-flinch-text-muted"
              )}>
                {msg.role === 'user' ? 'You' : 'Flinch'}
              </span>
            </div>
            <div className="whitespace-pre-wrap break-words">{msg.content}</div>
          </div>'''

new_msg = '''          <div
            key={msg.id}
            className={cn(
              "flinch-slide-in rounded-xl text-[13px] leading-relaxed shadow-sm flex flex-col",
              msg.role === 'user'
                ? "ml-6 p-3.5 bg-flinch-accent/15 text-flinch-text border border-flinch-accent/20 rounded-tr-none"
                : "mr-6 p-3.5 bg-flinch-surface/80 text-flinch-text-dim border border-flinch-border-dim rounded-tl-none"
            )}
            style={{ animationDelay: ${i * 20}ms }}
          >
            <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/5">
              {msg.role === 'user' ? (
                 <div className="w-5 h-5 rounded flex items-center justify-center bg-white/10 text-flinch-text-muted"><User size={12} weight="fill" /></div>
              ) : (
                 <div className="w-5 h-5 rounded flex items-center justify-center bg-flinch-accent/20 text-flinch-accent"><Robot size={12} weight="fill" /></div>
              )}
              <span className="text-[10px] uppercase tracking-wider font-bold opacity-50">{msg.role === 'user' ? 'You' : 'Flinch AI'}</span>
            </div>
            <div className="whitespace-pre-wrap break-words">{msg.content}</div>
          </div>'''
content = content.replace(old_msg, new_msg)

open('apps/desktop/ui/src/components/ChatPanel.tsx', 'w', encoding='utf-8').write(content)
