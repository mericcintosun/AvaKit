---
"@avakit/mcp": patch
---

The first `npx -y @avakit/mcp` on a machine is now a small download, so an MCP client no longer times out waiting for the server to connect: the server ships as one file with the MCP SDK, viem, zod and `@avakit/core` bundled into it (their licences are in `dist/THIRD_PARTY_LICENSES.txt`), and installs 48 packages instead of about 150.
`avakit-mcp --version` prints the version and `avakit-mcp --help` a short usage text; on a slow network, run `npx -y @avakit/mcp --version` once before adding the server to a client.
