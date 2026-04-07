/**
 * Polygon / EVM wallet address helpers.
 *
 * Clearline attaches wallets by paste only — no cryptographic verification —
 * so all we need is basic shape validation and normalization.
 */

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function isValidPolygonAddress(addr: string): boolean {
  return typeof addr === 'string' && ADDRESS_REGEX.test(addr);
}

export function normalizeAddress(addr: string): string {
  return addr.trim().toLowerCase();
}
