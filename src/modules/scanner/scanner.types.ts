import type { JsonRecord } from "../../types/index.js";

export interface TokenSignalInput {
  tokenAddress: string;
  pairAddress: string;
  chain: "solana";
  dex: string;
  symbol: string;
  name: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  marketCap: number | null;
  volume5m: number | null;
  volume1h: number | null;
  buys5m: number | null;
  sells5m: number | null;
  pairCreatedAt: Date | null;
  url: string | null;
  rawData: JsonRecord;
}

export interface TokenDiscoveryAdapter {
  fetchLatestSolanaSignals(): Promise<TokenSignalInput[]>;
}

export interface PriceTrackerAdapter {
  fetchPairByAddress(pairAddress: string, tokenAddress?: string): Promise<TokenSignalInput | null>;
}

export type MarketDataAdapter = TokenDiscoveryAdapter & PriceTrackerAdapter;
