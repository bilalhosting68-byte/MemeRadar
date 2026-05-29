import { describe, expect, it } from "vitest";
import {
  type ClosedPositionForMetrics,
  MetricsService,
} from "../src/modules/metrics/metrics.service.js";
import { DatabaseService } from "../src/modules/storage/database.service.js";

const makeClosedPosition = (overrides: Partial<ClosedPositionForMetrics>): ClosedPositionForMetrics => ({
  pnlUsd: 0,
  pnlPercent: 0,
  openedAt: new Date("2026-05-29T10:00:00.000Z"),
  closedAt: new Date("2026-05-29T10:10:00.000Z"),
  closeReason: "TAKE_PROFIT",
  riskLevel: "LOW",
  entryMarketCap: 100_000,
  entryLiquidityUsd: 50_000,
  ...overrides,
});

describe("MetricsService", () => {
  it("calculates profit factor and max virtual drawdown", () => {
    const service = new MetricsService({} as DatabaseService);
    const closed = [
      makeClosedPosition({ pnlUsd: 10, pnlPercent: 100 }),
      makeClosedPosition({ pnlUsd: -4, pnlPercent: -40, closeReason: "STOP_LOSS" }),
      makeClosedPosition({ pnlUsd: -6, pnlPercent: -60, closeReason: "STOP_LOSS" }),
      makeClosedPosition({ pnlUsd: 5, pnlPercent: 50, riskLevel: "MEDIUM" }),
    ];

    const snapshot = service.calculateSnapshot({
      totalPositions: 4,
      openPositions: 0,
      closedPositions: 4,
      closed,
    });

    expect(snapshot.profitFactor).toBe(1.5);
    expect(snapshot.maxDrawdownVirtualUsd).toBe(10);
    expect(snapshot.pnlByCloseReason.STOP_LOSS?.pnlUsd).toBe(-10);
    expect(snapshot.pnlByRiskLevel.LOW?.count).toBe(3);
    expect(snapshot.pnlByRiskLevel.MEDIUM?.pnlUsd).toBe(5);
  });
});
