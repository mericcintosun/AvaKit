---
"create-avalanche-app": patch
"@avakit/mcp": patch
"@avakit/studio": patch
---

Add an AvaKit brand banner to every terminal session — an ASCII mountain (snow
cap) above a block-letter AVAKIT wordmark in an Ember Crimson gradient. Printed on
startup by `create-avalanche-app`, `@avakit/mcp`, and `@avakit/studio`. It's raw
ANSI with no dependencies; color auto-disables on a non-TTY / when `NO_COLOR` is
set, and the MCP servers write it to stderr so the JSON-RPC channel stays clean.
`@avakit/studio`'s dashboard also gains a one-time terminal-style boot splash.
