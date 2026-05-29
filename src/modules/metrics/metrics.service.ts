import { env } from "../../config/env.js";
import { logger } from "../../logger.js";
import { roundTo } from "../../utils/math.js";
import { DatabaseService } from "../storage/database.service.js";

export interface ClosedPositionForMetrics {
  pnlUsd: number;
  pnlPercent: number;
  openedAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
  riskLevel: string;
  entryMarketCap: number | null;
  entryLiquidityUsd: number | null;
}

export interface PnlBreakdown {
  count: number;
  pnlUsd: number;
  averagePnlUsd: number;
  averagePnlPercent: number;
}

export interface MetricsSnapshot {
  totalPositions: number;
  openPositions: number;
  closedPositions: number;
  winratePercent: number;
  totalVirtualPnlUsd: number;
  averagePnlUsd: number;
  averagePnlPercent: number;
  biggestWinPercent: number;
  biggestLossPercent: number;
  averageHoldMinutes: number;
  profitFactor: number | "INF";
  maxDrawdownVirtualUsd: number;
  pnlByCloseReason: Record<string, PnlBreakdown>;
  pnlByRiskLevel: Record<string, PnlBreakdown>;
  pnlByMarketCapRange: Record<string, PnlBreakdown>;
  pnlByLiquidityRange: Record<string, PnlBreakdown>;
}

export class MetricsService {
  private interval: NodeJS.Timeout | null = null;

  constructor(private readonly database: DatabaseService) {}

  start(): void {
    if (this.interval) {
      return;
    }

    this.interval = setInterval(() => {
      void this.logMetrics();
    }, env.METRICS_INTERVAL_MINUTES * 60_000);

    void this.logMetrics();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async logMetrics(): Promise<void> {
    const [totalPositions, openPositions, closedPositions, closed] = await Promise.all([
      this.database.prisma.paperPosition.count(),
      this.database.prisma.paperPosition.count({ where: { status: "OPEN" } }),
      this.database.prisma.paperPosition.count({ where: { status: "CLOSED" } }),
      this.database.prisma.paperPosition.findMany({
        where: { status: "CLOSED" },
        select: {
          pnlUsd: true,
          pnlPercent: true,
          openedAt: true,
          closedAt: true,
          closeReason: true,
          riskLevel: true,
          entryMarketCap: true,
          entryLiquidityUsd: true,
        },
        orderBy: {
          closedAt: "asc",
        },
      }),
    ]);

    logger.info(
      this.calculateSnapshot({
        totalPositions,
        openPositions,
        closedPositions,
        closed,
      }),
      "Paper trading metrics",
    );
  }

  calculateSnapshot(input: {
    totalPositions: number;
    openPositions: number;
    closedPositions: number;
    closed: ClosedPositionForMetrics[];
  }): MetricsSnapshot {
    const { totalPositions, openPositions, closedPositions, closed } = input;
    const winningPositions = closed.filter((position) => position.pnlUsd > 0).length;
    const totalPnlUsd = closed.reduce((sum, position) => sum + position.pnlUsd, 0);
    const averagePnlUsd = closed.length > 0 ? totalPnlUsd / closed.length : 0;
    const averagePnlPercent = this.average(closed.map((position) => position.pnlPercent));
    const biggestWin = closed.length > 0 ? Math.max(...closed.map((position) => position.pnlPercent)) : 0;
    const biggestLoss = closed.length > 0 ? Math.min(...closed.map((position) => position.pnlPercent)) : 0;
    const winrate = closedPositions > 0 ? (winningPositions / closedPositions) * 100 : 0;
    const holdTimesMinutes = closed.map((position) => this.holdTimeMinutes(position));
    const grossProfit = closed.filter((position) => position.pnlUsd > 0).reduce((sum, position) => sum + position.pnlUsd, 0);
    const grossLoss = Math.abs(
      closed.filter((position) => position.pnlUsd < 0).reduce((sum, position) => sum + position.pnlUsd, 0),
    );
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0;

    return {
      totalPositions,
      openPositions,
      closedPositions,
      winratePercent: roundTo(winrate, 2),
      totalVirtualPnlUsd: roundTo(totalPnlUsd, 4),
      averagePnlUsd: roundTo(averagePnlUsd, 4),
      averagePnlPercent: roundTo(averagePnlPercent, 2),
      biggestWinPercent: roundTo(biggestWin, 2),
      biggestLossPercent: roundTo(biggestLoss, 2),
      averageHoldMinutes: roundTo(this.average(holdTimesMinutes), 2),
      profitFactor: profitFactor === null ? "INF" : roundTo(profitFactor, 4),
      maxDrawdownVirtualUsd: roundTo(this.maxDrawdownUsd(closed), 4),
      pnlByCloseReason: this.groupPnl(closed, (position) => position.closeReason ?? "UNKNOWN"),
      pnlByRiskLevel: this.groupPnl(closed, (position) => position.riskLevel),
      pnlByMarketCapRange: this.groupPnl(closed, (position) => this.marketCapRange(position.entryMarketCap)),
      pnlByLiquidityRange: this.groupPnl(closed, (position) => this.liquidityRange(position.entryLiquidityUsd)),
    };
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private holdTimeMinutes(position: ClosedPositionForMetrics): number {
    if (!position.closedAt) {
      return 0;
    }

    return Math.max(0, (position.closedAt.getTime() - position.openedAt.getTime()) / 60_000);
  }

  private maxDrawdownUsd(positions: ClosedPositionForMetrics[]): number {
    let cumulativePnl = 0;
    let peak = 0;
    let maxDrawdown = 0;

    for (const position of positions) {
      cumulativePnl += position.pnlUsd;
      peak = Math.max(peak, cumulativePnl);
      maxDrawdown = Math.max(maxDrawdown, peak - cumulativePnl);
    }

    return maxDrawdown;
  }

  private groupPnl(
    positions: ClosedPositionForMetrics[],
    keySelector: (position: ClosedPositionForMetrics) => string,
  ): Record<string, PnlBreakdown> {
    const grouped = new Map<string, ClosedPositionForMetrics[]>();

    for (const position of positions) {
      const key = keySelector(position);
      const bucket = grouped.get(key) ?? [];
      bucket.push(position);
      grouped.set(key, bucket);
    }

    return Object.fromEntries(
      [...grouped.entries()].map(([key, bucket]) => {
        const pnlUsd = bucket.reduce((sum, position) => sum + position.pnlUsd, 0);
        return [
          key,
          {
            count: bucket.length,
            pnlUsd: roundTo(pnlUsd, 4),
            averagePnlUsd: roundTo(pnlUsd / bucket.length, 4),
            averagePnlPercent: roundTo(this.average(bucket.map((position) => position.pnlPercent)), 2),
          },
        ];
      }),
    );
  }

  private marketCapRange(value: number | null): string {
    if (value === null) {
      return "unknown";
    }

    if (value < 10_000) {
      return "<10k";
    }

    if (value < 50_000) {
      return "10k-50k";
    }

    if (value < 100_000) {
      return "50k-100k";
    }

    if (value < 500_000) {
      return "100k-500k";
    }

    return "500k+";
  }

  private liquidityRange(value: number | null): string {
    if (value === null) {
      return "unknown";
    }

    if (value < 10_000) {
      return "<10k";
    }

    if (value < 50_000) {
      return "10k-50k";
    }

    if (value < 100_000) {
      return "50k-100k";
    }

    if (value < 250_000) {
      return "100k-250k";
    }

    return "250k+";
  }
}
