import { env } from "../../config/env.js";
import { logger } from "../../logger.js";
import type { PriceTrackerAdapter } from "../scanner/scanner.types.js";
import { DatabaseService } from "../storage/database.service.js";
import { PaperTradingService } from "../paperTrading/paperTrading.service.js";

export class PriceTrackerService {
  private interval: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly adapter: PriceTrackerAdapter,
    private readonly database: DatabaseService,
    private readonly paperTrading: PaperTradingService,
  ) {}

  start(): void {
    if (this.interval) {
      return;
    }

    this.interval = setInterval(() => {
      void this.updateOnce();
    }, env.POSITION_UPDATE_INTERVAL_SECONDS * 1000);

    void this.updateOnce();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async updateOnce(): Promise<void> {
    if (this.running) {
      logger.debug("Previous price tracker cycle still running; skipping this tick");
      return;
    }

    this.running = true;

    try {
      const positions = await this.database.getOpenPositions();

      for (const position of positions) {
        try {
          const latest = await this.adapter.fetchPairByAddress(position.pairAddress, position.tokenAddress);

          if (!latest || !this.hasUsablePrice(latest.priceUsd)) {
            const closed = await this.paperTrading.maybeCloseStalePosition(position);
            if (closed) {
              logger.info({ positionId: closed.id, symbol: closed.symbol }, "Closed stale paper position");
            }
            continue;
          }

          await this.paperTrading.updatePositionPrice(position, latest.priceUsd);
        } catch (error) {
          logger.warn({ error, positionId: position.id, pairAddress: position.pairAddress }, "Price update failed");
          await this.database.recordBotEvent("PRICE_TRACKER_ERROR", "Price update failed", {
            positionId: position.id,
            pairAddress: position.pairAddress,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      this.running = false;
    }
  }

  private hasUsablePrice(price: number | null): price is number {
    return price !== null && Number.isFinite(price) && price > 0;
  }
}
