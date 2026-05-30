import type { PaperPosition, TokenSignal } from "@prisma/client";
import { env } from "../../config/env.js";
import { logger } from "../../logger.js";
import type { PaperCloseReason, RiskLevel } from "../../types/index.js";
import { calculateBuyRatio, percentChange } from "../../utils/math.js";
import { DiscordService } from "../alerts/discord.service.js";
import type { RiskComputation } from "../risk/risk.types.js";
import { DatabaseService } from "../storage/database.service.js";
import type { EntryFilterEvaluation, PaperTradeDecision } from "./paperTrading.types.js";

const RISK_ORDER: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  EXTREME: 3,
};

export class PaperTradingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly alerts: DiscordService,
  ) {}

  async handleSignal(signal: TokenSignal, risk: RiskComputation): Promise<PaperTradeDecision> {
    const existingPosition = await this.database.findOpenPosition(signal.tokenAddress, signal.pairAddress);

    if (existingPosition) {
      return {
        decision: "SKIPPED",
        action: "Paper trade skipped: position already open",
        opened: false,
        skipped: true,
        passedFilters: false,
        reasons: ["Position already open for this token/pair"],
        positionId: existingPosition.id,
      };
    }

    const eligibility = await this.evaluateEntry(signal, risk);
    if (!eligibility.passed) {
      return {
        decision: "SKIPPED",
        action: `Paper trade skipped: ${eligibility.reasons.join("; ")}`,
        opened: false,
        skipped: true,
        passedFilters: false,
        reasons: eligibility.reasons,
      };
    }

    const position = await this.openPosition(signal, risk);
    await this.alerts.sendPositionOpened(position);
    await this.database.recordBotEvent("PAPER_POSITION_OPENED", `Opened paper position for ${signal.symbol}`, {
      positionId: position.id,
      tokenAddress: signal.tokenAddress,
      pairAddress: signal.pairAddress,
      symbol: signal.symbol,
    });

    return {
      decision: "OPENED",
      action: "Paper trade opened",
      opened: true,
      skipped: false,
      passedFilters: true,
      reasons: ["All entry filters passed"],
      positionId: position.id,
    };
  }

  async evaluateEntry(signal: TokenSignal, risk: RiskComputation): Promise<EntryFilterEvaluation> {
    const reasons: string[] = [];

    if (risk.level === "EXTREME" || !this.isRiskAllowed(risk.level, env.RISK_MAX_ALLOWED_LEVEL)) {
      reasons.push(`Risk level ${risk.level} exceeds allowed level ${env.RISK_MAX_ALLOWED_LEVEL}`);
    }

    if (!this.hasUsablePrice(signal.priceUsd)) {
      reasons.push("Price is missing or invalid");
    }

    if ((signal.liquidityUsd ?? 0) < env.MIN_LIQUIDITY_USD) {
      reasons.push(`Liquidity below minimum: ${signal.liquidityUsd ?? "missing"}`);
    }

    if ((signal.volume5m ?? 0) < env.MIN_VOLUME_5M_USD) {
      reasons.push(`5m volume below minimum: ${signal.volume5m ?? "missing"}`);
    }

    const buyRatio = calculateBuyRatio(signal.buys5m, signal.sells5m);
    if (buyRatio === null || buyRatio < env.MIN_BUY_RATIO) {
      reasons.push(`Buy ratio below minimum: ${buyRatio === null ? "missing" : buyRatio.toFixed(4)}`);
    }

    if (
      signal.marketCap === null ||
      signal.marketCap < env.MIN_MARKET_CAP_USD ||
      signal.marketCap > env.MAX_MARKET_CAP_USD
    ) {
      reasons.push(`Market cap outside configured range: ${signal.marketCap ?? "missing"}`);
    }

    const openPositions = await this.database.countOpenPositions();
    if (openPositions >= env.MAX_OPEN_POSITIONS) {
      reasons.push(`Max open positions reached: ${openPositions}/${env.MAX_OPEN_POSITIONS}`);
    }

    if (env.REENTRY_COOLDOWN_MINUTES > 0) {
      const closedAfter = new Date(Date.now() - env.REENTRY_COOLDOWN_MINUTES * 60_000);
      const recentClosedPosition = await this.database.findRecentlyClosedPosition(
        signal.tokenAddress,
        signal.pairAddress,
        closedAfter,
      );

      if (recentClosedPosition) {
        reasons.push(
          `Re-entry cooldown active for this token/pair: ${env.REENTRY_COOLDOWN_MINUTES} minutes`,
        );
      }
    }

    return {
      passed: reasons.length === 0,
      reasons,
    };
  }

  async updatePositionPrice(position: PaperPosition, marketPriceUsd: number): Promise<PaperPosition> {
    const highestPriceUsd = Math.max(position.highestPriceUsd, marketPriceUsd);
    const mark = this.calculateMarkedPnl(position, marketPriceUsd);
    const closeReason = this.getCloseReason(position, marketPriceUsd, highestPriceUsd);

    if (closeReason) {
      return this.closePosition(position, marketPriceUsd, highestPriceUsd, closeReason);
    }

    return this.database.updatePaperPosition(position.id, {
      currentPriceUsd: marketPriceUsd,
      highestPriceUsd,
      pnlUsd: mark.pnlUsd,
      pnlPercent: mark.pnlPercent,
    });
  }

  async maybeCloseStalePosition(position: PaperPosition): Promise<PaperPosition | null> {
    const staleMs = env.PRICE_STALE_MINUTES * 60_000;
    const lastUpdateMs = position.updatedAt.getTime();

    if (Date.now() - lastUpdateMs < staleMs) {
      return null;
    }

    return this.closePosition(position, position.currentPriceUsd, position.highestPriceUsd, "PRICE_STALE");
  }

  calculateMarkedPnl(position: PaperPosition, marketPriceUsd: number): { pnlUsd: number; pnlPercent: number } {
    const estimatedExitPrice = marketPriceUsd * (1 - env.SIMULATED_SELL_SLIPPAGE_PERCENT / 100);
    return this.calculateExitPnl(position, estimatedExitPrice);
  }

  calculateExitPnl(position: PaperPosition, exitPriceUsd: number): { pnlUsd: number; pnlPercent: number } {
    const grossExitValueUsd = position.tokenAmount * exitPriceUsd;
    const sellFeeUsd = grossExitValueUsd * (env.SIMULATED_FEE_PERCENT / 100);
    const netExitValueUsd = grossExitValueUsd - sellFeeUsd;
    const pnlUsd = netExitValueUsd - position.virtualSizeUsd;
    const pnlPercent = (pnlUsd / position.virtualSizeUsd) * 100;

    return { pnlUsd, pnlPercent };
  }

  getCloseReason(
    position: PaperPosition,
    marketPriceUsd: number,
    highestPriceUsd: number,
    now = new Date(),
  ): PaperCloseReason | null {
    const changePercent = percentChange(position.entryPriceUsd, marketPriceUsd);

    if (changePercent <= -position.stopLossPercent) {
      return "STOP_LOSS";
    }

    if (changePercent >= position.takeProfitPercent) {
      return "TAKE_PROFIT";
    }

    if (
      position.trailingStopPercent !== null &&
      position.trailingStopPercent > 0 &&
      highestPriceUsd > position.entryPriceUsd
    ) {
      const trailingStopPrice = highestPriceUsd * (1 - position.trailingStopPercent / 100);
      if (marketPriceUsd <= trailingStopPrice) {
        return "TRAILING_STOP";
      }
    }

    const maxHoldMs = env.MAX_HOLD_MINUTES * 60_000;
    if (now.getTime() - position.openedAt.getTime() >= maxHoldMs) {
      return "MAX_HOLD";
    }

    return null;
  }

  private async openPosition(signal: TokenSignal, risk: RiskComputation): Promise<PaperPosition> {
    if (!this.hasUsablePrice(signal.priceUsd)) {
      throw new Error("Cannot open a paper position without a valid price");
    }

    // Safety boundary: this is simulation only. No wallet, private key, signing, swaps, buys, or sells exist here.
    const entryPriceUsd = signal.priceUsd * (1 + env.SIMULATED_BUY_SLIPPAGE_PERCENT / 100);
    const buyFeeUsd = env.VIRTUAL_POSITION_SIZE_USD * (env.SIMULATED_FEE_PERCENT / 100);
    const netSizeUsd = env.VIRTUAL_POSITION_SIZE_USD - buyFeeUsd;
    const tokenAmount = netSizeUsd / entryPriceUsd;
    const initialPnlUsd = -buyFeeUsd;
    const initialPnlPercent = (initialPnlUsd / env.VIRTUAL_POSITION_SIZE_USD) * 100;

    return this.database.createPaperPosition({
      tokenSignalId: signal.id,
      tokenAddress: signal.tokenAddress,
      pairAddress: signal.pairAddress,
      symbol: signal.symbol,
      status: "OPEN",
      riskScore: risk.score,
      riskLevel: risk.level,
      entryMarketCap: signal.marketCap,
      entryLiquidityUsd: signal.liquidityUsd,
      entryPriceUsd,
      currentPriceUsd: signal.priceUsd,
      virtualSizeUsd: env.VIRTUAL_POSITION_SIZE_USD,
      tokenAmount,
      stopLossPercent: env.STOP_LOSS_PERCENT,
      takeProfitPercent: env.TAKE_PROFIT_PERCENT,
      trailingStopPercent: env.TRAILING_STOP_PERCENT,
      highestPriceUsd: signal.priceUsd,
      pnlUsd: initialPnlUsd,
      pnlPercent: initialPnlPercent,
      openedAt: new Date(),
    });
  }

  private async closePosition(
    position: PaperPosition,
    marketPriceUsd: number,
    highestPriceUsd: number,
    reason: PaperCloseReason,
  ): Promise<PaperPosition> {
    // Safety boundary: closing a paper position only updates database state. It never sells real tokens.
    const exitPriceUsd = marketPriceUsd * (1 - env.SIMULATED_SELL_SLIPPAGE_PERCENT / 100);
    const pnl = this.calculateExitPnl(position, exitPriceUsd);

    const closed = await this.database.updatePaperPosition(position.id, {
      status: "CLOSED",
      currentPriceUsd: marketPriceUsd,
      exitPriceUsd,
      highestPriceUsd,
      pnlUsd: pnl.pnlUsd,
      pnlPercent: pnl.pnlPercent,
      closeReason: reason,
      closedAt: new Date(),
    });

    logger.info(
      {
        symbol: closed.symbol,
        reason,
        pnlUsd: closed.pnlUsd,
        pnlPercent: closed.pnlPercent,
      },
      "Closed paper position",
    );

    await this.alerts.sendPositionClosed(closed);
    await this.database.recordBotEvent("PAPER_POSITION_CLOSED", `Closed paper position for ${closed.symbol}`, {
      positionId: closed.id,
      reason,
      pnlUsd: closed.pnlUsd,
      pnlPercent: closed.pnlPercent,
    });

    return closed;
  }

  private isRiskAllowed(level: RiskLevel, maxAllowed: RiskLevel): boolean {
    return RISK_ORDER[level] <= RISK_ORDER[maxAllowed];
  }

  private hasUsablePrice(price: number | null): price is number {
    return price !== null && Number.isFinite(price) && price > 0;
  }
}
