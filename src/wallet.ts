/**
 * Minimal read-only EVM wallet connection via EIP-1193 + EIP-6963 discovery.
 * Only `eth_requestAccounts` / `eth_accounts` are used — no signatures, no
 * transactions, no chain switching (ownership is read from HyperEVM mainnet
 * via the HL Names API regardless of the wallet's selected chain).
 */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: any[]) => void): void;
  removeListener?(event: string, handler: (...args: any[]) => void): void;
}

export interface WalletOption {
  id: string; // rdns or "injected"
  name: string;
  icon?: string;
  provider: Eip1193Provider;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

const discovered = new Map<string, WalletOption>();
let listeners: Array<() => void> = [];

export function startDiscovery(onChange: () => void): void {
  listeners.push(onChange);
  window.addEventListener('eip6963:announceProvider', (ev: Event) => {
    const d = (ev as CustomEvent<Eip6963Detail>).detail;
    if (!d?.info || !d.provider) return;
    const id = d.info.rdns || d.info.uuid;
    discovered.set(id, { id, name: d.info.name, icon: d.info.icon, provider: d.provider });
    listeners.forEach((l) => l());
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

export function getWalletOptions(): WalletOption[] {
  const list = [...discovered.values()];
  const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  if (list.length === 0 && injected) {
    list.push({ id: 'injected', name: 'Browser wallet', provider: injected });
  }
  return list;
}

export function findWallet(id: string): WalletOption | undefined {
  return getWalletOptions().find((w) => w.id === id);
}

function firstAccount(result: unknown): string | null {
  return Array.isArray(result) && typeof result[0] === 'string' ? result[0] : null;
}

/** Prompts the wallet for account access. */
export async function requestAccount(w: WalletOption): Promise<string | null> {
  return firstAccount(await w.provider.request({ method: 'eth_requestAccounts' }));
}

/** Silent check (no prompt) — used to restore a session after refresh. */
export async function getAuthorizedAccount(w: WalletOption): Promise<string | null> {
  try {
    return firstAccount(await w.provider.request({ method: 'eth_accounts' }));
  } catch {
    return null;
  }
}

/** Best-effort permission revoke (supported by some wallets). Never throws. */
export async function revoke(w: WalletOption): Promise<void> {
  try {
    await w.provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
  } catch {
    /* unsupported — app-level disconnect is still honoured */
  }
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
