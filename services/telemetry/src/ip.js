/**
 * The rate-limit key for a client address.
 *
 * An IPv4 address is its own key. An IPv6 client is keyed by its /64: a single
 * subscriber is routinely handed a whole /64 (2^64 addresses), so keying by the
 * full address would give it a fresh allowance on every request.
 *
 * (services/faucet/src/ip.js is a copy — the two Workers deploy on their own
 * and share no code. Change both.)
 */
export function clientKey(ip) {
  const address = String(ip ?? "")
    .trim()
    .toLowerCase();
  if (!address) return "unknown";
  if (!address.includes(":")) return address;

  const groups = ipv6Groups(address);
  // Cloudflare only ever sends a well-formed address; anything else is kept as
  // its own key rather than lumped in with somebody else.
  if (!groups) return address;

  // An IPv4 client reached over IPv6 (::ffff:192.0.2.1) is still one IPv4 host.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }

  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/** The eight 16-bit groups of an IPv6 address, or null if it isn't one. */
function ipv6Groups(address) {
  // Drop a zone id (fe80::1%eth0), then rewrite a dotted-quad tail as two groups.
  let text = address.split("%")[0];
  const dotted = text.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const bytes = dotted.slice(2).map(Number);
    if (bytes.some((byte) => byte > 255)) return null;
    const high = ((bytes[0] << 8) | bytes[1]).toString(16);
    const low = ((bytes[2] << 8) | bytes[3]).toString(16);
    text = `${dotted[1]}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];

  // "::" stands for the run of zero groups that brings the total to eight.
  const elided = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (elided < 0 || head.length + elided + tail.length !== 8) return null;

  const groups = [...head, ...Array(elided).fill("0"), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}
