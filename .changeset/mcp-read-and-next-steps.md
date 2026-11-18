---
"@avakit/mcp": patch
---

`scaffold_app` now gives its next steps with npm (`npm install`, `npm run dev`). They used to say `pnpm install`, which fails on a machine that has only Node.js, and an agent follows those lines literally. `read_chain` takes a contract's ABI the way `write_contract` does: as `artifactPath` (one of the files `scaffold_app` returned) or as `abi`, which can be just the signature of the function. It picks overloads by full signature, refuses a state-changing function with a pointer to `write_contract`, and reports a failed read in one line.
