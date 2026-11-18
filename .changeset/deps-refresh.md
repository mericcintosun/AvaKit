---
"create-avalanche-app": patch
"@avakit/core": patch
"@avakit/react": patch
"@avakit/mcp": patch
"@avakit/studio": patch
---

Scaffolded apps start on current dependency versions: every template now pins Next.js 16.4.6, React 19.3.1, viem 2.58.0, Tailwind CSS 4.3.5, lucide-react 1.73.0 and `@web3auth/modal` 11.4.3, all within the major versions they were already on. The packages' own dependencies move to the same versions: `@avakit/core` depends on viem 2.58.0, `@avakit/react` on `@radix-ui/react-dialog` 1.3.1, lucide-react 1.73.0 and tailwind-merge 3.7.0, `@avakit/mcp` and `@avakit/studio` on `@modelcontextprotocol/sdk` 1.32.2, zod 4.6.7 and viem 2.58.0, and the scaffolder itself on Ink 7.1.1 and React 19.3.1.
