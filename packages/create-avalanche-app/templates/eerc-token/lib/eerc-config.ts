import type { Hex } from "viem";

/**
 * Standalone eERC deployment on Avalanche Fuji, shared by every app scaffolded
 * from this template. Deployed with `ava-labs/EncryptedERC`'s
 * `scripts/deploy-standalone.ts` (name "Test", symbol "TEST", 2 decimals).
 * Run `pnpm deploy:eerc` to replace it with your own instance (required for
 * minting — `privateMint` is owner-only).
 */
export const EERC_CONTRACT_ADDRESS: Hex = "0xfB27bcdb845ECF231a36f3d14466e9ce9CF98d58";

/**
 * Circuit wasm + zkey files, served from the `ava-labs/EncryptedERC` repo via
 * jsDelivr's GitHub CDN, pinned to a commit so they never change under us.
 * Proof generation (registration/mint/transfer/withdraw/burn) runs fully
 * client-side in the browser via snarkjs — nothing is vendored in this repo.
 *
 * Every file is integrity-checked before use (`loadVerifiedCircuits`): the
 * whole privacy model rests on proving against the intended circuits, so a
 * tampered CDN copy must fail loudly, not prove quietly. The pinned commit
 * makes the URLs immutable-by-convention; the SHA-256 check makes it a
 * guarantee. The hashes were computed from the SOURCE repo
 * (raw.githubusercontent.com at this commit), deliberately not from the CDN
 * they guard.
 */
const CIRCUIT_COMMIT = "c7eb0e09bc9315e68c35d3c09f5dce4b794d0485";
const CIRCUIT_BASE = `https://cdn.jsdelivr.net/gh/ava-labs/EncryptedERC@${CIRCUIT_COMMIT}/circom/build`;

const CIRCUIT_FILES = {
  register: {
    wasm: { path: "registration/registration.wasm", sha256: "4c79b4d561b81c7ab3a516a57d71f941e4e5f7722b401eaf71b0a01aea2e4e39" },
    zkey: { path: "registration/circuit_final.zkey", sha256: "c55b573699363d6103bb8e3b3292e84dd175afce1bbb23e0ba785cef8c2eec43" },
  },
  mint: {
    wasm: { path: "mint/mint.wasm", sha256: "0942b52606b845a06936a4043c3c633edd64e9cf4be7a07c216ab86e78b22a4a" },
    zkey: { path: "mint/mint.zkey", sha256: "c2fb6a2691bf34f2199563e2f4c5289d7fb3bb4af15738da9b860f03431207d1" },
  },
  transfer: {
    wasm: { path: "transfer/transfer.wasm", sha256: "0197ef3d8f74d6024d5431417f6a20a03f444389e44c462c8f2e7d9d94fe2072" },
    zkey: { path: "transfer/transfer.zkey", sha256: "450a850d649c44dd01d89b5fe09c4fd9282560ee35da9821a9f84d683d65dfeb" },
  },
  withdraw: {
    wasm: { path: "withdraw/withdraw.wasm", sha256: "c94756e6b422646396d0a7f1498bb0799866f4367e562ee569b1e84b1579bc47" },
    zkey: { path: "withdraw/circuit_final.zkey", sha256: "9d687453c9d1819beb2da02591cbac97f8d1832c7d45423c2fdea10fb5104da0" },
  },
  burn: {
    wasm: { path: "burn/burn.wasm", sha256: "a17f212a2ecfafa5131f7b02ea712495e4a3b40d07fb2559c05fe0fe2fad0004" },
    zkey: { path: "burn/burn.zkey", sha256: "a10bbb798c87addea258e4e0746dcde3596e1fe74fcfaa5340f987e92ebbee00" },
  },
} as const;

/** The shape `useEERC` expects: a wasm + zkey URL per circuit. */
export type CircuitURLs = {
  [K in keyof typeof CIRCUIT_FILES]: { wasm: string; zkey: string };
};

async function fetchAndVerify(file: { path: string; sha256: string }): Promise<string> {
  // force-cache: the pinned URLs are immutable, so repeat visits (and the
  // second circuit that shares a URL with an earlier fetch) hit the browser
  // HTTP cache instead of re-downloading megabytes.
  const res = await fetch(`${CIRCUIT_BASE}/${file.path}`, { cache: "force-cache" });
  if (!res.ok) {
    throw new Error(`Circuit download failed: ${file.path} (HTTP ${res.status})`);
  }
  const bytes = await res.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (hex !== file.sha256) {
    throw new Error(
      `Circuit integrity check FAILED for ${file.path}: the CDN copy no longer ` +
        `matches the pinned source commit (expected sha256 ${file.sha256}, got ${hex}). ` +
        "Refusing to generate proofs against a tampered circuit.",
    );
  }
  // Hand the SDK a blob: URL, so what it proves against is exactly the bytes
  // that were just verified — not a second, unverified fetch.
  return URL.createObjectURL(new Blob([bytes]));
}

/**
 * Download every circuit, verify it against the pinned SHA-256, and return
 * blob URLs in the shape `useEERC` expects. ~50 MB on first visit (browser-
 * cached afterwards); rejects if any file fails its integrity check.
 */
export async function loadVerifiedCircuits(): Promise<CircuitURLs> {
  const entries = await Promise.all(
    Object.entries(CIRCUIT_FILES).map(async ([name, files]) => [
      name,
      { wasm: await fetchAndVerify(files.wasm), zkey: await fetchAndVerify(files.zkey) },
    ]),
  );
  return Object.fromEntries(entries) as CircuitURLs;
}
