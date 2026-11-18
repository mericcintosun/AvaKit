---
"create-avalanche-app": patch
---

The CLI now needs Node.js 22 or newer (`engines.node` is `>=22`). The library that draws the
interactive wizard already required Node.js 22, so on Node.js 20 or 21 npm warned about it and
stricter installers refused the CLI; such a Node.js now gets one line that names the version it
found and the one it needs, and nothing is created.

Pressing Ctrl+C at a wizard prompt now exits with status 130 instead of 0, after one line that
says whether anything was created, so a command chained with `&&` stops. Answering No to
"Create the app now?" still exits with 0 and now says "Nothing was created."
