/**
 * CB58 → hex. avalanche-cli stores a blockchain's ID in CB58 (base58 of the
 * 32-byte id followed by a 4-byte checksum). Teleporter routes by the raw
 * bytes32, so we decode the CB58 and drop the checksum — no CLI call needed.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) MAP[ALPHABET[i] as string] = i;

function base58Decode(input: string): Uint8Array {
  const bytes: number[] = [0];
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

/** Convert an avalanche-cli CB58 blockchain ID to a 0x-prefixed bytes32 hex. */
export function cb58ToHex(cb58: string): `0x${string}` {
  const decoded = base58Decode(cb58);
  // Strip the trailing 4-byte checksum.
  const payload = decoded.slice(0, Math.max(0, decoded.length - 4));
  const hex = Array.from(payload)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}
