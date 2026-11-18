/**
 * CB58 → hex. avalanche-cli stores a blockchain's ID in CB58 (base58 of the
 * 32-byte id followed by a 4-byte checksum: the last four bytes of the id's
 * SHA-256). Teleporter routes by the raw bytes32, so we decode the CB58, verify
 * it, and drop the checksum — no CLI call needed.
 */

import { createHash } from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) MAP[ALPHABET[i] as string] = i;

const ID_BYTES = 32;
const CHECKSUM_BYTES = 4;

function base58Decode(input: string): Uint8Array {
  // Little-endian while accumulating; reversed at the end.
  const bytes: number[] = [];
  for (const ch of input) {
    const value = MAP[ch];
    if (value === undefined) throw new Error(`invalid CB58 character: ${ch}`);
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += (bytes[j] as number) * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's are leading zero bytes.
  for (const ch of input) {
    if (ch === "1") bytes.push(0);
    else break;
  }
  return new Uint8Array(bytes.reverse());
}

/**
 * Convert an avalanche-cli CB58 blockchain ID to a 0x-prefixed bytes32 hex.
 * Throws when the input is not a well-formed ID — a wrong length or a checksum
 * mismatch means a corrupted or mistyped ID, and routing a message by it would
 * silently send it nowhere.
 */
export function cb58ToHex(cb58: string): `0x${string}` {
  const decoded = base58Decode(cb58);
  if (decoded.length !== ID_BYTES + CHECKSUM_BYTES) {
    throw new Error(
      `invalid CB58 blockchain ID: expected ${ID_BYTES} bytes plus a checksum, got ${decoded.length} bytes`,
    );
  }
  const payload = decoded.subarray(0, ID_BYTES);
  const checksum = decoded.subarray(ID_BYTES);
  const expected = createHash("sha256").update(payload).digest().subarray(-CHECKSUM_BYTES);
  if (!expected.equals(checksum)) {
    throw new Error("invalid CB58 blockchain ID: checksum mismatch");
  }
  return `0x${Buffer.from(payload).toString("hex")}`;
}
