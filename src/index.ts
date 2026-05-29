import { env } from "./config/env.js";
import { logger } from "./logger.js";
import { DiscordService } from "./modules/alerts/discord.service.js";
import { MetricsService } from "./modules/metrics/metrics.service.js";
import { PaperTradingService } from "./modules/paperTrading/paperTrading.service.js";
import { PriceTrackerService } from "./modules/priceTracker/priceTracker.service.js";
import { RiskService } from "./modules/risk/risk.service.js";
import { DexScreenerAdapter } from "./modules/scanner/dexscreener.adapter.js";
import { ScannerService } from "./modules/scanner/scanner.service.js";
import { DatabaseService } from "./modules/storage/database.service.js";

const database = new DatabaseService();
const alerts = new DiscordService();
const scannerAdapter = new DexScreenerAdapter();
const riskService = new RiskService();
const paperTrading = new PaperTradingService(database, alerts);
const scanner = new ScannerService(scannerAdapter, database, riskService, paperTrading, alerts);
const priceTracker = new PriceTrackerService(scannerAdapter, database, paperTrading);
const metrics = new MetricsService(database);

let shuttingDown = false;

const main = async (): Promise<void> => {
  // Safety boundary: MemeRadar MVP is paper trading only.
  // No wallet support, no private keys, no transaction signing, no real buy/sell execution.
  await database.connect();
  await database.recordBotEvent("BOT_STARTED", "MemeRadar started in paper trading mode", {
    tradingMode: "PAPER_ONLY",
    walletsEnabled: false,
    privateKeysEnabled: false,
    realTradingEnabled: false,
  });

  await alerts.sendBotStarted();

  scanner.start();
  priceTracker.start();
  metrics.start();

  logger.info(
    {
      scanIntervalSeconds: env.SCAN_INTERVAL_SECONDS,
      positionUpdateIntervalSeconds: env.POSITION_UPDATE_INTERVAL_SECONDS,
      maxOpenPositions: env.MAX_OPEN_POSITIONS,
      riskMaxAllowedLevel: env.RISK_MAX_ALLOWED_LEVEL,
      tradingMode: "PAPER_ONLY",
    },
    "MemeRadar started",
  );
};

const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, "Shutting down MemeRadar");

  scanner.stop();
  priceTracker.stop();
  metrics.stop();

  await database.recordBotEvent("BOT_STOPPED", `MemeRadar stopped by ${signal}`, { signal });
  await database.disconnect();

  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("uncaughtException", (error) => {
  logger.fatal({ error }, "Uncaught exception");
  void alerts.sendCriticalError(error, "uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled rejection");
  void alerts.sendCriticalError(reason, "unhandledRejection");
});

void main().catch(async (error) => {
  logger.fatal({ error }, "MemeRadar failed to start");
  await alerts.sendCriticalError(error, "startup");
  await database.disconnect();
  process.exit(1);
});
