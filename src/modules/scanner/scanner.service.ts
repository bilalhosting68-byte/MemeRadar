import { env } from "../../config/env.js";
import { logger } from "../../logger.js";
import { calculateBuyRatio } from "../../utils/math.js";
import { DiscordService } from "../alerts/discord.service.js";
import { PaperTradingService } from "../paperTrading/paperTrading.service.js";
import { RiskService } from "../risk/risk.service.js";
import { DatabaseService } from "../storage/database.service.js";
import type { TokenDiscoveryAdapter, TokenSignalInput } from "./scanner.types.js";

interface SignalDecisionLog {
  token: string;
  symbol: string;
  tokenAddress: string;
  pairAddress: string;
  liquidityUsd: number | null;
  volume5m: number | null;
  buyRatio: number | null;
  marketCap: number | null;
  riskScore: number;
  riskLevel: string;
  finalDecision: "OPENED" | "SKIPPED";
  decisionAction: string;
  decisionReasons: string[];
  passedFilters: boolean;
  created: boolean;
}

interface ScannerCycleSummary {
  fetched: number;
  analyzed: number;
  createdSignals: number;
  opened: number;
  skipped: number;
  failed: number;
  openedTokens: string[];
  topSkipReasons: Record<string, number>;
}

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
      const summary: ScannerCycleSummary = {
        fetched: signals.length,
        analyzed: 0,
        createdSignals: 0,
        opened: 0,
        skipped: 0,
        failed: 0,
        openedTokens: [],
        topSkipReasons: {},
      };

      for (const signalInput of signals) {
        const result = await this.processSignal(signalInput);

        if (!result) {
          summary.failed += 1;
          continue;
        }

        this.updateSummary(summary, result);
        this.logSignalDecision(result);
      }

      if (env.SIGNAL_DECISION_LOG_MODE !== "none") {
        logger.info(summary, "Scanner cycle summary");
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

  private async processSignal(input: TokenSignalInput): Promise<SignalDecisionLog | null> {
    try {
      if (input.chain !== "solana") {
        return null;
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

      return {
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
      };
    } catch (error) {
      logger.warn({ error, tokenAddress: input.tokenAddress, pairAddress: input.pairAddress }, "Failed to process signal");
      return null;
    }
  }

  private updateSummary(summary: ScannerCycleSummary, decision: SignalDecisionLog): void {
    summary.analyzed += 1;

    if (decision.created) {
      summary.createdSignals += 1;
    }

    if (decision.finalDecision === "OPENED") {
      summary.opened += 1;
      summary.openedTokens.push(decision.symbol);
      return;
    }

    summary.skipped += 1;

    for (const reason of decision.decisionReasons) {
      const normalized = this.normalizeSkipReason(reason);
      summary.topSkipReasons[normalized] = (summary.topSkipReasons[normalized] ?? 0) + 1;
    }
  }

  private logSignalDecision(decision: SignalDecisionLog): void {
    if (env.SIGNAL_DECISION_LOG_MODE === "all") {
      logger.info(decision, "Signal decision");
      return;
    }

    if (env.SIGNAL_DECISION_LOG_MODE === "opened" && decision.finalDecision === "OPENED") {
      logger.info(decision, "Signal decision opened");
    }
  }

  private normalizeSkipReason(reason: string): string {
    if (reason.startsWith("Risk level") && reason.includes("exceeds allowed level")) {
      return "Risk level exceeds allowed";
    }

    if (reason.startsWith("Re-entry cooldown active")) {
      return "Re-entry cooldown active";
    }

    if (reason.startsWith("Position already open")) {
      return "Position already open";
    }

    return reason.split(":")[0]?.trim() || reason;
  }
}
