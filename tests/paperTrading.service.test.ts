import type { PaperPosition, TokenSignal } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { DiscordService } from "../src/modules/alerts/discord.service.js";
import { PaperTradingService } from "../src/modules/paperTrading/paperTrading.service.js";
import type { RiskComputation } from "../src/modules/risk/risk.types.js";
import { DatabaseService } from "../src/modules/storage/database.service.js";

const riskLow: RiskComputation = {
  score: 20,
  level: "LOW",
  reasons: ["Test risk"],
};

const makeSignal = (overrides: Partial<TokenSignal> = {}): TokenSignal => ({
  id: "signal-1",
  tokenAddress: "token-1",
  pairAddress: "pair-1",
  chain: "solana",
  dex: "raydium",
  symbol: "MEME",
  name: "Meme",
  priceUsd: 1,
  liquidityUsd: 50_000,
  marketCap: 100_000,
  volume5m: 10_000,
  volume1h: 50_000,
  buys5m: 70,
  sells5m: 30,
  pairCreatedAt: new Date(Date.now() - 60 * 60 * 1000),
  url: "https://dexscreener.com/solana/pair-1",
  rawData: {},
  createdAt: new Date(),
  ...overrides,
});

const makePosition = (overrides: Partial<PaperPosition> = {}): PaperPosition => ({
  id: "position-1",
  tokenSignalId: "signal-1",
  tokenAddress: "token-1",
  pairAddress: "pair-1",
  symbol: "MEME",
  status: "OPEN",
  riskScore: 20,
  riskLevel: "LOW",
  entryMarketCap: 100_000,
  entryLiquidityUsd: 50_000,
  entryPriceUsd: 100,
  currentPriceUsd: 100,
  exitPriceUsd: null,
  virtualSizeUsd: 10,
  tokenAmount: 10,
  stopLossPercent: 25,
  takeProfitPercent: 60,
  trailingStopPercent: 25,
  highestPriceUsd: 100,
  pnlUsd: 0,
  pnlPercent: 0,
  closeReason: null,
  openedAt: new Date(Date.now() - 10 * 60 * 1000),
  closedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeService = (options: { openPositions?: number; existingPosition?: PaperPosition | null } = {}) => {
  const database = {
    countOpenPositions: vi.fn().mockResolvedValue(options.openPositions ?? 0),
    findOpenPosition: vi.fn().mockResolvedValue(options.existingPosition ?? null),
    createPaperPosition: vi.fn(async (data: Partial<PaperPosition>) => makePosition(data)),
    updatePaperPosition: vi.fn(async (id: string, data: Partial<PaperPosition>) => makePosition({ id, ...data })),
    recordBotEvent: vi.fn().mockResolvedValue(undefined),
  };

  const alerts = {
    sendPositionOpened: vi.fn().mockResolvedValue(undefined),
    sendPositionClosed: vi.fn().mockResolvedValue(undefined),
  };

  return {
    service: new PaperTradingService(database as unknown as DatabaseService, alerts as unknown as DiscordService),
    database,
    alerts,
  };
};

describe("PaperTradingService entry filters", () => {
  it("skips a signal when liquidity is below the configured minimum", async () => {
    const { service } = makeService();
    const decision = await service.handleSignal(makeSignal({ liquidityUsd: 1_000 }), riskLow);

    expect(decision.decision).toBe("SKIPPED");
    expect(decision.passedFilters).toBe(false);
    expect(decision.reasons.some((reason) => reason.includes("Liquidity below minimum"))).toBe(true);
  });

  it("opens a paper position when all entry filters pass", async () => {
    const { service } = makeService();
    const decision = await service.handleSignal(makeSignal(), riskLow);

    expect(decision.decision).toBe("OPENED");
    expect(decision.passedFilters).toBe(true);
    expect(decision.positionId).toBe("position-1");
  });

  it("applies simulated buy slippage and buy fee on entry", async () => {
    const { service, database } = makeService();
    await service.handleSignal(makeSignal({ priceUsd: 1 }), riskLow);

    expect(database.createPaperPosition).toHaveBeenCalledTimes(1);

    const created = database.createPaperPosition.mock.calls[0]?.[0];
    expect(created?.entryPriceUsd).toBeCloseTo(1.03, 8);
    expect(created?.tokenAmount).toBeCloseTo(9.9 / 1.03, 8);
    expect(created?.pnlUsd).toBeCloseTo(-0.1, 8);
    expect(created?.pnlPercent).toBeCloseTo(-1, 8);
  });
});

describe("PaperTradingService PNL and exits", () => {
  it("calculates exit PNL after simulated sell fee", () => {
    const { service } = makeService();
    const position = makePosition({ virtualSizeUsd: 10, tokenAmount: 10 });

    const pnl = service.calculateExitPnl(position, 2);

    expect(pnl.pnlUsd).toBeCloseTo(9.8, 5);
    expect(pnl.pnlPercent).toBeCloseTo(98, 5);
  });

  it("applies simulated sell slippage on close", async () => {
    const { service, database } = makeService();
    const position = makePosition({
      entryPriceUsd: 100,
      currentPriceUsd: 100,
      tokenAmount: 0.1,
      virtualSizeUsd: 10,
      takeProfitPercent: 60,
    });

    await service.updatePositionPrice(position, 160);

    const update = database.updatePaperPosition.mock.calls[0]?.[1];
    expect(update?.status).toBe("CLOSED");
    expect(update?.exitPriceUsd).toBeCloseTo(152, 8);
    expect(update?.closeReason).toBe("TAKE_PROFIT");
  });

  it("detects stop loss", () => {
    const { service } = makeService();
    const position = makePosition({ entryPriceUsd: 100, stopLossPercent: 25 });

    expect(service.getCloseReason(position, 74, 100)).toBe("STOP_LOSS");
  });

  it("detects take profit", () => {
    const { service } = makeService();
    const position = makePosition({ entryPriceUsd: 100, takeProfitPercent: 60 });

    expect(service.getCloseReason(position, 160, 160)).toBe("TAKE_PROFIT");
  });

  it("detects trailing stop", () => {
    const { service } = makeService();
    const position = makePosition({
      entryPriceUsd: 100,
      highestPriceUsd: 150,
      trailingStopPercent: 25,
      takeProfitPercent: 60,
    });

    expect(service.getCloseReason(position, 110, 150)).toBe("TRAILING_STOP");
  });

  it("detects max hold", () => {
    const { service } = makeService();
    const openedAt = new Date("2026-05-29T10:00:00.000Z");
    const now = new Date("2026-05-29T10:31:00.000Z");
    const position = makePosition({ entryPriceUsd: 100, openedAt });

    expect(service.getCloseReason(position, 100, 100, now)).toBe("MAX_HOLD");
  });

  it("closes a stale price position", async () => {
    const { service } = makeService();
    const position = makePosition({
      updatedAt: new Date(Date.now() - 6 * 60 * 1000),
      currentPriceUsd: 100,
      highestPriceUsd: 110,
    });

    const closed = await service.maybeCloseStalePosition(position);

    expect(closed?.status).toBe("CLOSED");
    expect(closed?.closeReason).toBe("PRICE_STALE");
  });
});
