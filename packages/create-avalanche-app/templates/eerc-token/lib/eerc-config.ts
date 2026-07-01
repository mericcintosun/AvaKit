import type { Hex } from "viem";

/**
 * Standalone eERC deployment on Avalanche Fuji, shared by every app scaffolded
 * from this template. Deployed with `ava-labs/EncryptedERC`'s
 * `scripts/deploy-standalone.ts` (name "Test", symbol "TEST", 2 decimals).
 * Redeploy your own instance if you need a fresh registrar / auditor.
 */
export const EERC_CONTRACT_ADDRESS: Hex = "0xfB27bcdb845ECF231a36f3d14466e9ce9CF98d58";

/**
 * Circuit wasm + zkey files, served from the `ava-labs/EncryptedERC` repo via
 * jsDelivr's GitHub CDN, pinned to a commit so they never change under us.
 * Proof generation (registration/mint/transfer/withdraw/burn) runs fully
 * client-side in the browser via snarkjs — nothing is vendored in this repo.
 */
const CIRCUIT_COMMIT = "c7eb0e09bc9315e68c35d3c09f5dce4b794d0485";
const CIRCUIT_BASE = `https://cdn.jsdelivr.net/gh/ava-labs/EncryptedERC@${CIRCUIT_COMMIT}/circom/build`;

export const circuitURLs = {
  register: {
    wasm: `${CIRCUIT_BASE}/registration/registration.wasm`,
    zkey: `${CIRCUIT_BASE}/registration/circuit_final.zkey`,
  },
  mint: {
    wasm: `${CIRCUIT_BASE}/mint/mint.wasm`,
    zkey: `${CIRCUIT_BASE}/mint/mint.zkey`,
  },
  transfer: {
    wasm: `${CIRCUIT_BASE}/transfer/transfer.wasm`,
    zkey: `${CIRCUIT_BASE}/transfer/transfer.zkey`,
  },
  withdraw: {
    wasm: `${CIRCUIT_BASE}/withdraw/withdraw.wasm`,
    zkey: `${CIRCUIT_BASE}/withdraw/circuit_final.zkey`,
  },
  burn: {
    wasm: `${CIRCUIT_BASE}/burn/burn.wasm`,
    zkey: `${CIRCUIT_BASE}/burn/burn.zkey`,
  },
};
