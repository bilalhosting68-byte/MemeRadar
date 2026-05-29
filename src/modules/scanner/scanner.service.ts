import { env } from "../../config/env.js";
import { logger } from "../../logger.js";
import { calculateBuyRatio } from "../../utils/math.js";
import { DiscordService } from "../alerts/discord.service.js";
import { PaperTradingService } from "../paperTrading/paperTrading.service.js";
import { RiskService } from "../risk/risk.service.js";
import { DatabaseService } from "../storage/database.service.js";
import type { TokenDiscoveryAdapter, TokenSignalInput } from "./scanner.types.js";

export class ScannerService {
  private interval: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly adapter: TokenDiscoveryAdapter,
    private readonly database: DatabaseService,
    private readonly riskService: RiskService,
    private readonly paperTrading: PaperTradingService,
    private readonly alerts: DiscordService,
  ) {}

  start(): void {
    if (this.interval) {
      return;
    }

    this.interval = setInterval(() => {
      void this.scanOnce();
    }, env.SCAN_INTERVAL_SECONDS * 1000);

    void this.scanOnce();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async scanOnce(): Promise<void> {
    if (this.running) {
      logger.debug("Previous scanner cycle still running; skipping this tick");
      return;
    }

    this.running = true;

    try {
      const signals = await this.adapter.fetchLatestSolanaSignals();
      logger.info({ count: signals.length }, "Scanner cycle fetched Solana signals");

      for (const signalInput of signals) {
        await this.processSignal(signalInput);
      }
    } catch (error) {
      logger.error({ error }, "Scanner cycle failed");
      await this.database.recordBotEvent("SCANNER_ERROR", "Scanner cycle failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.running = false;
    }
  }

  private async processSignal(input: TokenSignalInput): Promise<void> {
    try {
      if (input.chain !== "solana") {
        return;
      }

      const risk = this.riskService.calculate(input);
      const { signal, created } = await this.database.upsertTokenSignal(input);

      await this.database.createRiskResult(signal.id, risk);

      if (created) {
        await this.database.recordBotEvent("TOKEN_SIGNAL_CREATED", `New token signal for ${signal.symbol}`, {
          tokenSignalId: signal.id,
          tokenAddress: signal.tokenAddress,
          pairAddress: signal.pairAddress,
          riskScore: risk.score,
          riskLevel: risk.level,
        });
      }

      const decision = await this.paperTrading.handleSignal(signal, risk);
      await this.database.createSignalDecision(signal.id, decision, risk);

      if (created && risk.level !== "EXTREME") {
        await this.alerts.sendNewSignal(signal, risk, decision.action);
      }

      const buyRatio = calculateBuyRatio(signal.buys5m, signal.sells5m);
      logger.info(
        {
          token: signal.symbol,
          symbol: signal.symbol,
          tokenAddress: signal.tokenAddress,
          pairAddress: signal.pairAddress,
          liquidityUsd: signal.liquidityUsd,
          volume5m: signal.volume5m,
          buyRatio,
          marketCap: signal.marketCap,
          riskScore: risk.score,
          riskLevel: risk.level,
          finalDecision: decision.decision,
          decisionAction: decision.action,
          decisionReasons: decision.reasons,
          passedFilters: decision.passedFilters,
          created,
        },
        "Signal decision",
      );
    } catch (error) {
      logger.warn({ error, tokenAddress: input.tokenAddress, pairAddress: input.pairAddress }, "Failed to process signal");
    }
  }
}
