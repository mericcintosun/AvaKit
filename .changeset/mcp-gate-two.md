---
"@avakit/mcp": patch
---

A file under the 2 MB artifact limit built to make the parser backtrack could keep the server busy for minutes, during which no tool answered; reading an artifact now takes time in proportion to its size. When `scaffold_app` creates a project in a sub-directory (`directory`), its first next step now changes into that path from where the agent stands, instead of into the project's name.
