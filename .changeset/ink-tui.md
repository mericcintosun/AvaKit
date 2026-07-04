---
"create-avalanche-app": patch
---

Rebuild the interactive CLI as a real terminal app with Ink (React for the
terminal). Running `npm create avalanche-app` now renders a bordered,
Ember-Crimson panel: the ASCII AvaKit banner, a step-by-step wizard with
brand-colored selection, live scaffolding/install progress, and a framed success
summary with next steps and links. Non-interactive runs (`--yes`, CI, pipes) stay
plain and scriptable. Templates are also shown in a curated order (starters first).
