---
"create-avalanche-app": patch
---

Every command a scaffolded app shows is now written for npm (`npm install`, `npm run dev`, `npm run devnet`, `npm run l1`, `npm run bridge`, `npm run deploy:eerc`), so it works on a machine with only Node.js; pnpm, yarn and bun work as well. The NFT demo shows a mint as "Mint sent" until its receipt succeeds and never puts a check mark on a mint that reverted, and the token bridge demo reports a reverted mint, approve or send as an error instead of showing the tokens in flight. When the confidential-token demo cannot download its proving circuits, it says which host was blocked and offers "Try again", while a circuit file that fails its integrity check is still refused.
