---
"create-avalanche-app": patch
---

Reject unsafe project names (path traversal, absolute paths, separators) before
scaffolding, and guard against a template writing outside the project directory.
