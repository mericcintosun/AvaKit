---
"create-avalanche-app": patch
---

Add the `icm-messenger` template: send a message between two Avalanche L1s using Interchain Messaging (ICM / Teleporter), against a one-command local devnet. Ships a send/receive `AvaKitMessenger` contract, a `scripts/devnet.sh` that spins up two local L1s with ICM + a relayer, and a UI that deploys on both chains and watches a message cross over.
