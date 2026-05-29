import type { PaperPosition, TokenSignal } from "@prisma/client";
import { env } from "../../config/env.js";
import { logger } from "../../logger.js";
import { calculateBuyRatio, roundTo } from "../../utils/math.js";
import type { RiskComputation } from "../risk/risk.types.js";

export class DiscordService {
  async sendBotStarted(): Promise<void> {
    await this.send("🟢 Bot Started\nMode: PAPER TRADING ONLY\nWallets: disabled\nPrivate keys: disabled");
  }

  async sendNewSignal(signal: TokenSignal, risk: RiskComputation, action: string): Promise<void> {
    const buySell = `${signal.buys5m ?? 0}/${signal.sells5m ?? 0}`;

    await this.send(
      [
        "🚨 New Meme Signal",
        `Token: ${signal.symbol}`,
        `Risk: ${risk.level} - ${risk.score}/100`,
        `Liquidity: ${this.formatUsd(signal.liquidityUsd)}`,
        `Volume 5m: ${this.formatUsd(signal.volume5m)}`,
        `Buy/Sell 5m: ${buySell}`,
        `Buy ratio: ${this.formatRatio(calculateBuyRatio(signal.buys5m, signal.sells5m))}`,
        `Market Cap: ${this.formatUsd(signal.marketCap)}`,
        `Action: ${action}`,
        `Link: ${signal.url ?? "N/A"}`,
      ].join("\n"),
    );
  }

  async sendPositionOpened(position: PaperPosition): Promise<void> {
    await this.send(
      [
        "🟩 Paper Position Opened",
        `Token: ${position.symbol}`,
        `Entry: ${this.formatUsd(position.entryPriceUsd)}`,
        `Size: ${this.formatUsd(position.virtualSizeUsd)}`,
        `Token Amount: ${roundTo(position.tokenAmount, 8)}`,
        `Stop Loss: ${position.stopLossPercent}%`,
        `Take Profit: ${position.takeProfitPercent}%`,
      ].join("\n"),
    );
  }

  async sendPositionClosed(position: PaperPosition): Promise<void> {
    await this.send(
      [
        "📈 Paper Position Closed",
        `Token: ${position.symbol}`,
        `Entry: ${this.formatUsd(position.entryPriceUsd)}`,
        `Exit: ${this.formatUsd(position.exitPriceUsd)}`,
        `PNL: ${this.formatPercent(position.pnlPercent)}`,
        `PNL USD: ${this.formatUsd(position.pnlUsd)}`,
        `Reason: ${position.closeReason ?? "N/A"}`,
      ].join("\n"),
    );
  }

  async sendCriticalError(error: unknown, context: string): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.send(["🔴 Critical Error", `Context: ${context}`, `Error: ${message}`].join("\n"));
  }

  private async send(content: string): Promise<void> {
    if (!env.DISCORD_WEBHOOK_URL) {
      logger.debug({ content }, "Discord webhook not configured; alert skipped");
      return;
    }

    try {
      const response = await fetch(env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      logger.warn({ error }, "Failed to send Discord alert");
    }
  }

  private formatUsd(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return "N/A";
    }

    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: value < 1 ? 8 : 2,
    }).format(value);
  }

  private formatPercent(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return "N/A";
    }

    const sign = value > 0 ? "+" : "";
    return `${sign}${roundTo(value, 2)}%`;
  }

  private formatRatio(value: number | null): string {
    if (value === null) {
      return "N/A";
    }

    return `${roundTo(value * 100, 1)}%`;
  }
}
