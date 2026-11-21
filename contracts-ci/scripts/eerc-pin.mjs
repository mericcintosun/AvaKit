// The eerc-token template proves in the browser with circuit files of
// ava-labs/EncryptedERC at one commit (CIRCUIT_COMMIT in lib/eerc-config.ts),
// and `npm run deploy:eerc` deploys the contracts of a commit
// (COMMIT in scripts/deploy-eerc.mjs) with that repository's own
// scripts/deploy-standalone.ts. A proof the app makes is accepted only by a
// verifier that carries the verification key of the proving key it was made
// with, so this checks, at the pinned commit:
//
// 1. the two constants name the same commit;
// 2. deploy-standalone.ts deploys the production verifiers
//    (`deployVerifiers(<signer>, true)`), which test/helpers.ts takes from
//    contracts/prod/. (Before 2026-08-31 it deployed the generated ones in
//    contracts/verifiers/, whose keys match none of the circuit files and were
//    made without a phase-2 contribution: they rejected every real proof and
//    would have accepted forged ones.)
// 3. each production verifier, contracts/prod/<Name>Verifier.sol, carries
//    exactly the key in circom/build/<name>/<name>_verification_key.json,
//    which sits next to the proving key the app downloads, and that key's
//    delta is not its gamma: a key with delta = gamma (no phase-2
//    contribution) accepts a forged proof for any statement.
//
// With `circuits: true` it also downloads the ten pinned circuit files from
// the source repository at that commit (about 55 MB) and compares their
// SHA-256 with the pins: worth doing whenever the pin moves.
//
// It reads raw.githubusercontent.com. The files at a commit cannot change, so
// a failure here means the pin moved, or upstream's layout did at the new pin.

import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY = "ava-labs/EncryptedERC";
const TEMPLATE = "packages/create-avalanche-app/templates/eerc-token";
const CONFIG = `${TEMPLATE}/lib/eerc-config.ts`;
const DEPLOY = `${TEMPLATE}/scripts/deploy-eerc.mjs`;

async function fetchBytes(commit, path) {
  const url = `https://raw.githubusercontent.com/${REPOSITORY}/${commit}/${path}`;
  let failure;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      failure = `HTTP ${response.status}`;
      if (response.status === 404) break;
    } catch (error) {
      failure = error.cause?.code ?? error.message;
    }
    await new Promise((done) => setTimeout(done, 500 * attempt));
  }
  throw new Error(`could not download ${url} (${failure})`);
}

/** The numeric constants a Solidity verifier declares, by name. */
function constants(source) {
  const found = new Map();
  for (const [, name, value] of source.matchAll(/uint256\s+constant\s+(\w+)\s*=\s*(\d+)\s*;/g)) {
    found.set(name, value);
  }
  return found;
}

/** The key a snarkjs Solidity verifier embeds. Its G2 points are written
 * x1 = x[1], x2 = x[0], y1 = y[1], y2 = y[0] of the JSON key's coordinates. */
function keyOfVerifier(source) {
  const c = constants(source);
  const g2 = (name) => [`${name}x1`, `${name}x2`, `${name}y1`, `${name}y2`].map((k) => c.get(k));
  const ic = [];
  for (let i = 0; c.has(`IC${i}x`); i++) ic.push([c.get(`IC${i}x`), c.get(`IC${i}y`)]);
  return {
    alpha: [c.get("alphax"), c.get("alphay")],
    beta: g2("beta"),
    gamma: g2("gamma"),
    delta: g2("delta"),
    ic,
  };
}

/** The same key from a snarkjs verification_key.json. */
function keyOfJson(json) {
  const g2 = (point) => [point[0][1], point[0][0], point[1][1], point[1][0]];
  return {
    alpha: [json.vk_alpha_1[0], json.vk_alpha_1[1]],
    beta: g2(json.vk_beta_2),
    gamma: g2(json.vk_gamma_2),
    delta: g2(json.vk_delta_2),
    ic: json.IC.map((point) => [point[0], point[1]]),
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Check the pin of eerc-token in the repo at `repoRoot`. Returns
 * `{ commit, notes, problems }`: what was checked and what is wrong (empty
 * when the pin is sound).
 */
export async function checkEercPin(repoRoot, { circuits = false } = {}) {
  const problems = [];
  const notes = [];
  const config = readFileSync(join(repoRoot, CONFIG), "utf8");
  const deploy = readFileSync(join(repoRoot, DEPLOY), "utf8");
  const commit = config.match(/const CIRCUIT_COMMIT = "([0-9a-f]{40})";/)?.[1];
  const deployed = deploy.match(/const COMMIT = "([0-9a-f]{40})";/)?.[1];
  if (!commit || !deployed) {
    return {
      commit,
      notes,
      problems: [`${CONFIG} needs a CIRCUIT_COMMIT and ${DEPLOY} a COMMIT, each a full commit id`],
    };
  }
  if (commit !== deployed) {
    problems.push(
      `CIRCUIT_COMMIT (${CONFIG}) is ${commit} but COMMIT (${DEPLOY}) is ${deployed}: ` +
        "the app would prove with one version and deploy another",
    );
  }

  const files = [
    ...config.matchAll(/(wasm|zkey): \{ path: "([^"]+)", sha256: "([0-9a-f]{64})" \}/g),
  ].map(([, kind, path, sha256]) => ({ kind, path, sha256 }));
  const names = [...new Set(files.map(({ path }) => path.split("/")[0]))];
  if (files.length === 0) problems.push(`${CONFIG} pins no circuit files`);

  try {
    const script = (await fetchBytes(commit, "scripts/deploy-standalone.ts")).toString("utf8");
    const helpers = (await fetchBytes(commit, "test/helpers.ts")).toString("utf8");
    if (!/deployVerifiers\(\s*\w+\s*,\s*true\s*\)/.test(script)) {
      problems.push(
        `scripts/deploy-standalone.ts at ${commit} does not deploy the production verifiers ` +
          "(no `deployVerifiers(<signer>, true)`): what it deploys is not checked against the circuits",
      );
    }
    if (!/from\s+"\.\.\/typechain-types\/factories\/contracts\/prod"/.test(helpers)) {
      problems.push(
        `test/helpers.ts at ${commit} no longer takes its production verifiers from contracts/prod`,
      );
    }

    for (const name of names) {
      const contract = `${name[0].toUpperCase()}${name.slice(1)}Verifier`;
      const verifier = keyOfVerifier(
        (await fetchBytes(commit, `contracts/prod/${contract}.sol`)).toString("utf8"),
      );
      const json = keyOfJson(
        JSON.parse(
          (await fetchBytes(commit, `circom/build/${name}/${name}_verification_key.json`)).toString(
            "utf8",
          ),
        ),
      );
      if (!same(verifier, json)) {
        const differing = Object.keys(json).filter((part) => !same(verifier[part], json[part]));
        problems.push(
          `contracts/prod/${contract}.sol at ${commit} does not carry the key of ` +
            `circom/build/${name} (${differing.join(", ")} differ): it would reject the app's proofs`,
        );
      } else if (same(json.delta, json.gamma)) {
        problems.push(
          `the ${name} key at ${commit} has delta = gamma (no phase-2 contribution): ` +
            "a verifier with it accepts forged proofs",
        );
      } else {
        notes.push(
          `${name}: contracts/prod/${contract}.sol carries the key of circom/build/${name}`,
        );
      }
    }

    if (circuits) {
      for (const { path, sha256 } of files) {
        const bytes = await fetchBytes(commit, `circom/build/${path}`);
        const got = createHash("sha256").update(bytes).digest("hex");
        if (got === sha256) notes.push(`${path}: sha256 matches the pin`);
        else
          problems.push(
            `circom/build/${path} at ${commit} has sha256 ${got}, the pin says ${sha256}`,
          );
      }
    }
  } catch (error) {
    problems.push(error.message);
  }
  return { commit, notes, problems };
}

// Run as a script (`node scripts/eerc-pin.mjs [--circuits]`), not imported.
// Real paths on both sides: a temporary directory is often reached through a
// symlink (/var -> /private/var on macOS), and import.meta.url is resolved.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
  const { commit, notes, problems } = await checkEercPin(repoRoot, {
    circuits: process.argv.includes("--circuits"),
  });
  for (const note of notes) console.log(`ok ${note}`);
  for (const problem of problems) console.error(`EERC PIN: ${problem}`);
  if (problems.length === 0) console.log(`ok eerc-token pin ${REPOSITORY}@${commit}`);
  process.exit(problems.length === 0 ? 0 : 1);
}
