import { env } from "../../config/env.js";
import { logger } from "../../logger.js";
import { sleep } from "../../utils/sleep.js";
import { toFiniteInt, toFiniteNumber } from "../../utils/math.js";
import type { JsonRecord } from "../../types/index.js";
import type { MarketDataAdapter, TokenSignalInput } from "./scanner.types.js";

const DEXSCREENER_BASE_URL = "https://api.dexscreener.com";
const SOLANA_CHAIN_ID = "solana";

class NonRetryableDexScreenerError extends Error {}

interface DexScreenerTokenProfile {
  chainId?: string;
  tokenAddress?: string;
}

interface DexScreenerPair {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  quoteToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  priceUsd?: string | number | null;
  txns?: {
    m5?: {
      buys?: number;
      sells?: number;
    };
  };
  volume?: {
    m5?: number;
    h1?: number;
  };
  liquidity?: {
    usd?: number;
  } | null;
  fdv?: number | null;
  marketCap?: number | null;
  pairCreatedAt?: number | null;
}

interface DexScreenerPairsResponse {
  pairs?: DexScreenerPair[] | null;
}

interface RequestLimiter {
  nextRequestAt: number;
  queue: Promise<void>;
}

export class DexScreenerAdapter implements MarketDataAdapter {
  private readonly profileLimiter: RequestLimiter = {
    nextRequestAt: 0,
    queue: Promise.resolve(),
  };

  private readonly pairLimiter: RequestLimiter = {
    nextRequestAt: 0,
    queue: Promise.resolve(),
  };

  async fetchLatestSolanaSignals(): Promise<TokenSignalInput[]> {
    const candidates = await this.fetchSolanaCandidateTokenAddresses();

    if (candidates.length === 0) {
      logger.debug("DexScreener returned no Solana candidate tokens");
      return [];
    }

    const batches = this.chunk(candidates, 30);
    const normalized: TokenSignalInput[] = [];

    for (const batch of batches) {
      try {
        const path = `/tokens/v1/${SOLANA_CHAIN_ID}/${batch.join(",")}`;
        const pairs = await this.fetchJson<DexScreenerPair[]>(path);
        const candidateSet = new Set(batch);

        for (const pair of pairs) {
          const signal = this.normalizePair(pair, candidateSet);
          if (signal !== null) {
            normalized.push(signal);
          }
        }
      } catch (error) {
        logger.warn({ error, batchSize: batch.length }, "Failed to fetch DexScreener token pairs batch");
      }
    }

    return this.dedupeSignals(normalized);
  }

  async fetchPairByAddress(pairAddress: string, tokenAddress?: string): Promise<TokenSignalInput | null> {
    try {
      const response = await this.fetchJson<DexScreenerPairsResponse>(
        `/latest/dex/pairs/${SOLANA_CHAIN_ID}/${pairAddress}`,
      );
      const pair = response.pairs?.[0];

      if (!pair) {
        return null;
      }

      return this.normalizePair(pair, tokenAddress ? new Set([tokenAddress]) : new Set());
    } catch (error) {
      logger.warn({ error, pairAddress }, "Failed to fetch DexScreener pair");
      return null;
    }
  }

  private async fetchSolanaCandidateTokenAddresses(): Promise<string[]> {
    const [profiles, boosted] = await Promise.allSettled([
      this.fetchJson<DexScreenerTokenProfile[]>("/token-profiles/latest/v1"),
      this.fetchJson<DexScreenerTokenProfile[]>("/token-boosts/latest/v1"),
    ]);

    const rawCandidates = [
      ...(profiles.status === "fulfilled" ? profiles.value : []),
      ...(boosted.status === "fulfilled" ? boosted.value : []),
    ];

    if (profiles.status === "rejected") {
      logger.warn({ error: profiles.reason }, "Failed to fetch latest token profiles");
    }

    if (boosted.status === "rejected") {
      logger.warn({ error: boosted.reason }, "Failed to fetch latest boosted tokens");
    }

    return [
      ...new Set(
        rawCandidates
          .filter((candidate) => candidate.chainId?.toLowerCase() === SOLANA_CHAIN_ID)
          .map((candidate) => candidate.tokenAddress)
          .filter((address): address is string => typeof address === "string" && address.length > 0),
      ),
    ].slice(0, env.DEXSCREENER_MAX_TOKENS_PER_SCAN);
  }

  private normalizePair(pair: DexScreenerPair, candidateTokenAddresses: Set<string>): TokenSignalInput | null {
    if (pair.chainId?.toLowerCase() !== SOLANA_CHAIN_ID) {
      return null;
    }

    const pairAddress = pair.pairAddress;
    const baseAddress = pair.baseToken?.address;
    const quoteAddress = pair.quoteToken?.address;
    const trackedTokenAddress = this.resolveTrackedTokenAddress(baseAddress, quoteAddress, candidateTokenAddresses);

    if (!pairAddress || !trackedTokenAddress) {
      return null;
    }

    const tokenMeta =
      trackedTokenAddress === quoteAddress && pair.quoteToken ? pair.quoteToken : pair.baseToken ?? pair.quoteToken;

    const marketCap = toFiniteNumber(pair.marketCap) ?? toFiniteNumber(pair.fdv);
    const pairCreatedAt = toFiniteNumber(pair.pairCreatedAt);

    return {
      tokenAddress: trackedTokenAddress,
      pairAddress,
      chain: SOLANA_CHAIN_ID,
      dex: pair.dexId ?? "unknown",
      symbol: tokenMeta?.symbol ?? "UNKNOWN",
      name: tokenMeta?.name ?? null,
      priceUsd: toFiniteNumber(pair.priceUsd),
      liquidityUsd: toFiniteNumber(pair.liquidity?.usd),
      marketCap,
      volume5m: toFiniteNumber(pair.volume?.m5),
      volume1h: toFiniteNumber(pair.volume?.h1),
      buys5m: toFiniteInt(pair.txns?.m5?.buys),
      sells5m: toFiniteInt(pair.txns?.m5?.sells),
      pairCreatedAt: pairCreatedAt ? new Date(pairCreatedAt) : null,
      url: pair.url ?? null,
      rawData: pair as JsonRecord,
    };
  }

  private resolveTrackedTokenAddress(
    baseAddress: string | undefined,
    quoteAddress: string | undefined,
    candidateTokenAddresses: Set<string>,
  ): string | null {
    if (baseAddress && candidateTokenAddresses.has(baseAddress)) {
      return baseAddress;
    }

    if (quoteAddress && candidateTokenAddresses.has(quoteAddress)) {
      return quoteAddress;
    }

    return baseAddress ?? quoteAddress ?? null;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= env.DEXSCREENER_MAX_RETRIES) {
      try {
        await this.waitForRequestSlot(path);

        const response = await fetch(`${DEXSCREENER_BASE_URL}${path}`, {
          headers: {
            Accept: "application/json",
            "User-Agent": "MemeRadar/0.1.0",
          },
          signal: AbortSignal.timeout(env.DEXSCREENER_REQUEST_TIMEOUT_MS),
        });

        if (response.ok) {
          return (await response.json()) as T;
        }

        const error = new Error(`DexScreener request failed: ${response.status} ${response.statusText}`);

        if (!this.shouldRetryStatus(response.status)) {
          throw new NonRetryableDexScreenerError(error.message);
        }

        if (attempt >= env.DEXSCREENER_MAX_RETRIES) {
          throw error;
        }

        const delayMs = this.getRetryDelayMs(attempt, response.headers.get("retry-after"));
        logger.warn(
          { status: response.status, path, attempt: attempt + 1, delayMs },
          "Retrying DexScreener request after HTTP failure",
        );
        await sleep(delayMs);
      } catch (error) {
        lastError = error;

        if (error instanceof NonRetryableDexScreenerError) {
          break;
        }

        if (attempt >= env.DEXSCREENER_MAX_RETRIES) {
          break;
        }

        const delayMs = this.getRetryDelayMs(attempt);
        logger.warn(
          { error, path, attempt: attempt + 1, delayMs },
          "Retrying DexScreener request after network failure",
        );
        await sleep(delayMs);
      }

      attempt += 1;
    }

    throw lastError instanceof Error ? lastError : new Error(`DexScreener request failed for ${path}`);
  }

  private async waitForRequestSlot(path: string): Promise<void> {
    const limiter = this.getLimiter(path);
    const previous = limiter.queue;
    let release!: () => void;
    limiter.queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    const waitMs = Math.max(0, limiter.nextRequestAt - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    limiter.nextRequestAt = Date.now() + this.getLimiterIntervalMs(path);
    release();
  }

  private getLimiter(path: string): RequestLimiter {
    return this.isProfileEndpoint(path) ? this.profileLimiter : this.pairLimiter;
  }

  private getLimiterIntervalMs(path: string): number {
    return this.isProfileEndpoint(path)
      ? env.DEXSCREENER_PROFILE_MIN_REQUEST_INTERVAL_MS
      : env.DEXSCREENER_PAIR_MIN_REQUEST_INTERVAL_MS;
  }

  private isProfileEndpoint(path: string): boolean {
    return path.startsWith("/token-profiles/") || path.startsWith("/token-boosts/");
  }

  private shouldRetryStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private getRetryDelayMs(attempt: number, retryAfterHeader?: string | null): number {
    const retryAfterMs = this.parseRetryAfterMs(retryAfterHeader);
    if (retryAfterMs !== null) {
      return retryAfterMs;
    }

    const exponential = env.DEXSCREENER_BASE_BACKOFF_MS * 2 ** attempt;
    const jitter = Math.floor(Math.random() * env.DEXSCREENER_BASE_BACKOFF_MS);
    return Math.min(exponential + jitter, env.DEXSCREENER_MAX_BACKOFF_MS);
  }

  private parseRetryAfterMs(retryAfterHeader?: string | null): number | null {
    if (!retryAfterHeader) {
      return null;
    }

    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }

    const dateMs = Date.parse(retryAfterHeader);
    if (Number.isFinite(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }

    return null;
  }

  private dedupeSignals(signals: TokenSignalInput[]): TokenSignalInput[] {
    const byKey = new Map<string, TokenSignalInput>();

    for (const signal of signals) {
      byKey.set(`${signal.tokenAddress}:${signal.pairAddress}`, signal);
    }

    return [...byKey.values()].sort((a, b) => {
      const first = b.pairCreatedAt?.getTime() ?? 0;
      const second = a.pairCreatedAt?.getTime() ?? 0;
      return first - second;
    });
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }
}
