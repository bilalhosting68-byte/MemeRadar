import "dotenv/config";
import { z } from "zod";

const positiveNumber = z.coerce.number().finite().positive();
const nonNegativeNumber = z.coerce.number().finite().nonnegative();
const positiveInteger = z.coerce.number().int().positive();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DISCORD_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),

  SCAN_INTERVAL_SECONDS: positiveInteger.default(15),
  POSITION_UPDATE_INTERVAL_SECONDS: positiveInteger.default(15),
  METRICS_INTERVAL_MINUTES: positiveInteger.default(5),

  MIN_LIQUIDITY_USD: nonNegativeNumber.default(10_000),
  MIN_VOLUME_5M_USD: nonNegativeNumber.default(5_000),
  MIN_BUY_RATIO: z.coerce.number().finite().min(0).max(1).default(0.6),
  MIN_MARKET_CAP_USD: nonNegativeNumber.default(10_000),
  MAX_MARKET_CAP_USD: positiveNumber.default(500_000),

  VIRTUAL_POSITION_SIZE_USD: positiveNumber.default(10),
  MAX_OPEN_POSITIONS: positiveInteger.default(3),

  SIMULATED_BUY_SLIPPAGE_PERCENT: nonNegativeNumber.default(3),
  SIMULATED_SELL_SLIPPAGE_PERCENT: nonNegativeNumber.default(5),
  SIMULATED_FEE_PERCENT: nonNegativeNumber.default(1),

  STOP_LOSS_PERCENT: positiveNumber.default(25),
  TAKE_PROFIT_PERCENT: positiveNumber.default(60),
  TRAILING_STOP_PERCENT: nonNegativeNumber.default(25),
  MAX_HOLD_MINUTES: positiveInteger.default(30),
  PRICE_STALE_MINUTES: positiveInteger.default(5),

  RISK_MAX_ALLOWED_LEVEL: z.enum(["LOW", "MEDIUM", "HIGH", "EXTREME"]).default("MEDIUM"),

  DEXSCREENER_MAX_TOKENS_PER_SCAN: positiveInteger.default(20),
  DEXSCREENER_REQUEST_TIMEOUT_MS: positiveInteger.default(10_000),
  DEXSCREENER_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  DEXSCREENER_BASE_BACKOFF_MS: positiveInteger.default(500),
  DEXSCREENER_MAX_BACKOFF_MS: positiveInteger.default(8_000),
  DEXSCREENER_PROFILE_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().min(0).default(1_000),
  DEXSCREENER_PAIR_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().min(0).default(250),

  LOG_LEVEL: z.string().min(1).default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const data = parsed.data;

if (data.MIN_MARKET_CAP_USD > data.MAX_MARKET_CAP_USD) {
  console.error("Invalid environment configuration: MIN_MARKET_CAP_USD must be <= MAX_MARKET_CAP_USD");
  process.exit(1);
}

export const env = {
  ...data,
  DISCORD_WEBHOOK_URL: data.DISCORD_WEBHOOK_URL || undefined,
} as const;
