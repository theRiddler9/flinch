
content = open("apps/desktop/ui/src/components/ChatPanel.tsx", "r", encoding="utf-8").read()
content = content.replace("style={{ animationDelay: ${i * 20}ms }}", "style={{ animationDelay: `${i * 20}ms` }}")
open("apps/desktop/ui/src/components/ChatPanel.tsx", "w", encoding="utf-8").write(content)

