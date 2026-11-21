---
"create-avalanche-app": minor
"@avakit/mcp": patch
---

The three templates that need Avalanche CLI (`icm-messenger`, `l1-launch` and `token-bridge`) are now marked experimental in their manifests: the wizard labels them in the list and warns once one is chosen, a non-interactive `--template` run prints the same warning before it scaffolds, `--help` names them, `listTemplates()` reports every template's `status`, and the MCP server's `list_templates` shows it too, because the server ships this scaffolder.
