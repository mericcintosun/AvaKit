---
"create-avalanche-app": patch
"@avakit/studio": patch
---

`create-avalanche-app`: after scaffolding, the wizard offers to start the dev
server for you (`Start the dev server now?`), so you don't have to `cd` + run it
by hand. Only shown for dev-able templates once dependencies are installed;
declining just prints the next steps as before.

`@avakit/studio`: the startup output is now a crimson-bordered panel showing the
dashboard URL, matching the CLI banner's look.
