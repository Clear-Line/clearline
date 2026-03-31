/**
 * Polygon chain client — viem PublicClient for reading Polymarket on-chain events.
 *
 * Uses HTTP transport to poll getLogs every 5 minutes (no WebSocket needed).
 * Exports contract addresses, ABI definitions, and the client singleton.
 */

import { createPublicClient, http, type PublicClient } from 'viem';
import { polygon } from 'viem/chains';

// ─── Polymarket Exchange Contracts on Polygon ───

/** Binary (YES/NO) markets */
export const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E' as const;

/** Multi-outcome markets (NegRisk) */
export const NEGRISK_CTF_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a' as const;

export const EXCHANGE_ADDRESSES = [CTF_EXCHANGE, NEGRISK_CTF_EXCHANGE] as const;

// ─── OrderFilled Event ABI ───

export const orderFilledAbi = [
  {
    type: 'event',
    name: 'OrderFilled',
    inputs: [
      { name: 'orderHash', type: 'bytes32', indexed: true },
      { name: 'maker', type: 'address', indexed: true },
      { name: 'taker', type: 'address', indexed: true },
      { name: 'makerAssetId', type: 'uint256', indexed: false },
      { name: 'takerAssetId', type: 'uint256', indexed: false },
      { name: 'makerAmountFilled', type: 'uint256', indexed: false },
      { name: 'takerAmountFilled', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
  },
] as const;

// ─── Client ───

let _client: PublicClient | null = null;

export function getPolygonClient(): PublicClient {
  if (_client) return _client;

  const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com';

  _client = createPublicClient({
    chain: polygon,
    transport: http(rpcUrl),
  });

  return _client;
}
