import { HLN_API_BASE, HLN_API_KEY } from './config';

export interface OwnedName {
  /** Display name, e.g. "ori.hl" */
  name: string;
  /** Stable identity: lowercase 0x-prefixed 32-byte namehash */
  namehash: string;
  tokenId: string;
  /** Unix seconds, or null when the expiry lookup failed. */
  expiry: number | null;
}

export class HlnApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const NAMEHASH_RE = /^0x[0-9a-f]{64}$/;

async function getJson(path: string, signal?: AbortSignal): Promise<{ status: number; ok: boolean; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(`${HLN_API_BASE}${path}`, { headers: { 'X-API-Key': HLN_API_KEY, Accept: 'application/json' }, signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new HlnApiError('Could not reach the HL Names API. Check your connection.');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, ok: res.ok, body };
}

function errorMessage(body: unknown, status: number): string {
  const err = (body as { error?: unknown } | null)?.error;
  if (typeof err === 'string') return err;
  const e = err as { details?: string; message?: string } | undefined;
  return e?.details ?? e?.message ?? `HTTP ${status}`;
}

/**
 * Expiry of a name: GET /metadata/expiry/:nameHashOrId → { "expiry": "1771416632" }.
 * Returns null if the lookup fails (the name is then shown as "expiry unverified").
 */
async function fetchExpiry(namehash: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const { ok, body } = await getJson(`/metadata/expiry/${namehash}`, signal);
    if (!ok) return null;
    const v = Number((body as { expiry?: unknown } | null)?.expiry);
    return Number.isFinite(v) ? v : null;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return null;
  }
}

/**
 * Names owned (NFT owner — not resolved address / primary name) by `address` on
 * HyperEVM mainnet: GET /utils/names_owner/:address, then each name's expiry is
 * checked so only active (unexpired) names are returned.
 */
export async function fetchOwnedNames(address: string, signal?: AbortSignal): Promise<OwnedName[]> {
  const { ok, status, body } = await getJson(`/utils/names_owner/${address.toLowerCase()}`, signal);
  if (!ok) {
    if (status === 404) return []; // endpoint-specific absence → owns nothing
    throw new HlnApiError(`HL Names API error: ${errorMessage(body, status)}`, status);
  }
  if (!Array.isArray(body)) throw new HlnApiError('Unexpected response from the HL Names API.');

  const seen = new Set<string>();
  const out: OwnedName[] = [];
  for (const item of body) {
    if (!item || typeof item !== 'object') continue;
    const { name, namehash, tokenid } = item as Record<string, unknown>;
    if (typeof name !== 'string' || typeof namehash !== 'string') continue;
    const hash = namehash.toLowerCase();
    if (!NAMEHASH_RE.test(hash) || seen.has(hash)) continue;
    seen.add(hash);
    out.push({ name, namehash: hash, tokenId: typeof tokenid === 'string' ? tokenid : String(tokenid ?? ''), expiry: null });
  }

  // Active-status check, 6 requests at a time.
  let i = 0;
  const worker = async () => {
    while (i < out.length) {
      const n = out[i++];
      n.expiry = await fetchExpiry(n.namehash, signal);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, out.length) }, worker));

  const now = Date.now() / 1000;
  // Drop names the API reports as expired (or "0" = not registered). Unknown expiry is kept but flagged.
  return out
    .filter((n) => n.expiry === null || n.expiry > now)
    .sort((a, b) => a.name.localeCompare(b.name));
}
