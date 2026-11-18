---
"create-avalanche-app": patch
---

The CLI now installs with the package manager you launched it with (falling back to
npm), and when that manager is missing or the install fails it says so, prints the
commands to run by hand and exits non-zero instead of printing "Done". Unknown flags,
templates, chains and package managers are rejected with the list of valid values
rather than silently replaced, each template can only be scaffolded for the chains its
manifest lists (only `minimal` supports `c-chain`), and a hand-written telemetry
opt-out is no longer overwritten.

On Windows the package manager is started through a shell, as the `.cmd` shims of npm,
pnpm and yarn require. A scaffold that fails part-way removes what it wrote instead of
blocking the retry, and build output or local `.env` files left inside a template
directory are no longer copied into the new app.
