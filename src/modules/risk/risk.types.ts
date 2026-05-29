import type { RiskLevel } from "../../types/index.js";

export interface RiskSignal {
  tokenAddress?: string | null;
  pairAddress?: string | null;
  priceUsd?: number | null;
  liquidityUsd?: number | null;
  marketCap?: number | null;
  volume5m?: number | null;
  buys5m?: number | null;
  sells5m?: number | null;
  pairCreatedAt?: Date | null;
}

export interface RiskComputation {
  score: number;
  level: RiskLevel;
  reasons: string[];
}
