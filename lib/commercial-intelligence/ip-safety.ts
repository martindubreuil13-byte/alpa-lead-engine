// Byte-level classification of IP addresses for outbound website fetching.
//
// An address is "public" only if it is a normal, globally routable unicast address. Everything
// else (private, loopback, link-local, multicast, reserved, documentation, translation
// prefixes that wrap a non-public IPv4) is refused. IPv4-mapped IPv6 addresses in any textual
// form (::ffff:127.0.0.1, ::ffff:7f00:1, 0:0:0:0:0:ffff:7f00:1) are judged by the IPv4 inside.

import { isIP } from 'node:net'

type Cidr4 = [a: number, b: number, c: number, d: number, prefix: number]

const BLOCKED_IPV4: Cidr4[] = [
  [0, 0, 0, 0, 8], // "this" network
  [10, 0, 0, 0, 8], // private
  [100, 64, 0, 0, 10], // carrier-grade NAT
  [127, 0, 0, 0, 8], // loopback
  [169, 254, 0, 0, 16], // link-local (cloud metadata lives here)
  [172, 16, 0, 0, 12], // private
  [192, 0, 0, 0, 24], // IETF protocol assignments
  [192, 0, 2, 0, 24], // documentation
  [192, 88, 99, 0, 24], // 6to4 relay (deprecated)
  [192, 168, 0, 0, 16], // private
  [198, 18, 0, 0, 15], // benchmarking
  [198, 51, 100, 0, 24], // documentation
  [203, 0, 113, 0, 24], // documentation
  [224, 0, 0, 0, 4], // multicast
  [240, 0, 0, 0, 4], // reserved + broadcast
]

export function parseIPv4(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN))
  return bytes.every((value) => value >= 0 && value <= 255) ? bytes : null
}

export function parseIPv6(input: string): number[] | null {
  let address = input.toLowerCase().split('%')[0]
  if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1)
  if (isIP(address) !== 6) return null

  // Embedded dotted IPv4 tail ("::ffff:1.2.3.4") becomes two hex groups.
  const tail = address.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (tail) {
    const v4 = parseIPv4(tail[1])
    if (!v4) return null
    address = address.slice(0, -tail[1].length) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16)
  }

  const halves = address.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - rest.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null

  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest]
  if (groups.length !== 8) return null

  const bytes: number[] = []
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null
    const value = parseInt(group, 16)
    bytes.push(value >> 8, value & 0xff)
  }
  return bytes
}

function ipv4Blocked(bytes: number[]) {
  return BLOCKED_IPV4.some(([a, b, c, d, prefix]) => {
    const network = [a, b, c, d]
    let remaining = prefix
    for (let index = 0; index < 4 && remaining > 0; index += 1) {
      const bits = Math.min(8, remaining)
      const mask = (0xff << (8 - bits)) & 0xff
      if ((bytes[index] & mask) !== (network[index] & mask)) return false
      remaining -= bits
    }
    return true
  })
}

function startsWith(bytes: number[], prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value)
}

function ipv6NonPublic(bytes: number[]) {
  const zeros = (from: number, to: number) => bytes.slice(from, to).every((value) => value === 0)

  // ::, ::1, and IPv4-compatible ::a.b.c.d (deprecated): all non-public.
  if (zeros(0, 12)) return true

  // IPv4-mapped ::ffff:a.b.c.d is judged by the IPv4 address inside.
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return ipv4Blocked(bytes.slice(12))

  // NAT64 well-known prefix 64:ff9b::/96 is judged by the embedded IPv4; the local-use
  // prefix 64:ff9b:1::/48 is never public.
  if (startsWith(bytes, [0x00, 0x64, 0xff, 0x9b])) {
    if (zeros(4, 12)) return ipv4Blocked(bytes.slice(12))
    return true
  }

  // Only global unicast (2000::/3) can be public.
  if ((bytes[0] & 0xe0) !== 0x20) return true

  if (startsWith(bytes, [0x20, 0x01, 0x00, 0x00])) return true // 2001::/32 Teredo
  if (startsWith(bytes, [0x20, 0x01, 0x00, 0x02, 0x00, 0x00])) return true // 2001:2::/48 benchmarking
  if (startsWith(bytes, [0x20, 0x01, 0x0d, 0xb8])) return true // 2001:db8::/32 documentation
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] >= 0x10 && bytes[3] <= 0x2f) {
    return true // 2001:10::/28 ORCHID and 2001:20::/28 ORCHIDv2
  }
  if (startsWith(bytes, [0x20, 0x02])) return true // 2002::/16 6to4
  if (bytes[0] === 0x3f && bytes[1] === 0xff && (bytes[2] & 0xf0) === 0x00) return true // 3fff::/20 documentation

  return false
}

/** True when `address` must not be contacted. Anything that is not a valid IP literal is non-public. */
export function isNonPublicAddress(address: string): boolean {
  const normalized = String(address || '').trim().replace(/^\[|\]$/g, '').split('%')[0]
  const version = isIP(normalized)

  if (version === 4) {
    const bytes = parseIPv4(normalized)
    return !bytes || ipv4Blocked(bytes)
  }

  if (version === 6) {
    const bytes = parseIPv6(normalized)
    return !bytes || ipv6NonPublic(bytes)
  }

  return true
}
