import type { TokenSignal } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { DiscordService } from "../src/modules/alerts/discord.service.js";
import { PaperTradingService } from "../src/modules/paperTrading/paperTrading.service.js";
import { RiskService } from "../src/modules/risk/risk.service.js";
import type { RiskComputation } from "../src/modules/risk/risk.types.js";
import { ScannerService } from "../src/modules/scanner/scanner.service.js";
import type { TokenDiscoveryAdapter, TokenSignalInput } from "../src/modules/scanner/scanner.types.js";
import { DatabaseService } from "../src/modules/storage/database.service.js";

const risk: RiskComputation = {
  score: 25,
  level: "LOW",
  reasons: ["Test risk"],
};

const makeInput = (id: number): TokenSignalInput => ({
  tokenAddress: `token-${id}`,
  pairAddress: `pair-${id}`,
  chain: "solana",
  dex: "raydium",
  symbol: `MEME${id}`,
  name: `Meme ${id}`,
  priceUsd: 1,
  liquidityUsd: 50_000,
  marketCap: 100_000,
  volume5m: 10_000,
  volume1h: 50_000,
  buys5m: 70,
  sells5m: 30,
  pairCreatedAt: new Date(Date.now() - 60 * 60 * 1000),
  url: `https://dexscreener.com/solana/pair-${id}`,
  rawData: {},
});

const makeSignal = (input: TokenSignalInput, id: number): TokenSignal => ({
  id: `signal-${id}`,
  ...input,
  createdAt: new Date(),
});

describe("ScannerService SignalDecision persistence", () => {
  it("persists OPENED and SKIPPED decisions", async () => {
    const inputs = [makeInput(1), makeInput(2)];

    const adapter = {
      fetchLatestSolanaSignals: vi.fn().mockResolvedValue(inputs),
    } as unknown as TokenDiscoveryAdapter;

    const database = {
      upsertTokenSignal: vi
        .fn()
        .mockResolvedValueOnce({ signal: makeSignal(inputs[0]!, 1), created: true })
        .mockResolvedValueOnce({ signal: makeSignal(inputs[1]!, 2), created: true }),
      createRiskResult: vi.fn().mockResolvedValue(undefined),
      createSignalDecision: vi.fn().mockResolvedValue(undefined),
      recordBotEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as DatabaseService;

    const riskService = {
      calculate: vi.fn().mockReturnValue(risk),
    } as unknown as RiskService;

    const paperTrading = {
      handleSignal: vi
        .fn()
        .mockResolvedValueOnce({
          decision: "OPENED",
          action: "Paper trade opened",
          opened: true,
          skipped: false,
          passedFilters: true,
          reasons: ["All entry filters passed"],
        })
        .mockResolvedValueOnce({
          decision: "SKIPPED",
          action: "Paper trade skipped: liquidity below minimum",
          opened: false,
          skipped: true,
          passedFilters: false,
          reasons: ["Liquidity below minimum"],
        }),
    } as unknown as PaperTradingService;

    const alerts = {
      sendNewSignal: vi.fn().mockResolvedValue(undefined),
    } as unknown as DiscordService;

    const scanner = new ScannerService(adapter, database, riskService, paperTrading, alerts);

    await scanner.scanOnce();

    expect(database.createSignalDecision).toHaveBeenCalledTimes(2);
    expect(vi.mocked(database.createSignalDecision).mock.calls[0]?.[1].decision).toBe("OPENED");
    expect(vi.mocked(database.createSignalDecision).mock.calls[1]?.[1].decision).toBe("SKIPPED");
  });
});
