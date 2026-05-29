import { describe, expect, it } from "vitest";
import { RiskService } from "../src/modules/risk/risk.service.js";
import type { RiskSignal } from "../src/modules/risk/risk.types.js";

const service = new RiskService();

describe("RiskService", () => {
  it("returns LOW risk for a strong complete signal", () => {
    const signal: RiskSignal = {
      tokenAddress: "So11111111111111111111111111111111111111112",
      pairAddress: "pair-1",
      priceUsd: 0.01,
      liquidityUsd: 50_000,
      marketCap: 120_000,
      volume5m: 10_000,
      buys5m: 80,
      sells5m: 20,
      pairCreatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    };

    const result = service.calculate(signal);

    expect(result.level).toBe("LOW");
    expect(result.score).toBeLessThanOrEqual(30);
  });

  it("returns EXTREME risk for missing and weak data", () => {
    const signal: RiskSignal = {
      tokenAddress: null,
      pairAddress: null,
      priceUsd: null,
      liquidityUsd: 1_000,
      marketCap: 1_000,
      volume5m: 100,
      buys5m: 1,
      sells5m: 20,
      pairCreatedAt: new Date(),
    };

    const result = service.calculate(signal);

    expect(result.level).toBe("EXTREME");
    expect(result.score).toBe(100);
    expect(result.reasons.length).toBeGreaterThan(3);
  });
});
