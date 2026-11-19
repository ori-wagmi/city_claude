/** Hyperliquid Names REST API (HyperEVM mainnet). See README for details. */
export const HLN_API_BASE: string = (import.meta.env.VITE_HLN_API_BASE || 'https://api.hlnames.xyz').replace(/\/+$/, '');

/**
 * Public agent key published by HL Names in the use-hln-api skill
 * (https://github.com/HLnames/use-hln-api). Override with VITE_HLN_API_KEY.
 */
export const HLN_API_KEY: string = import.meta.env.VITE_HLN_API_KEY || 'NILB2EY-R4LUDOA-WN5G5JQ-KHAQOLA';
