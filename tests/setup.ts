process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://memeradar:memeradar@localhost:5432/memeradar?schema=public";
process.env.DISCORD_WEBHOOK_URL ??= "";
process.env.LOG_LEVEL ??= "silent";

process.env.MIN_LIQUIDITY_USD ??= "15000";
process.env.MIN_VOLUME_5M_USD ??= "10000";
process.env.MIN_BUY_RATIO ??= "0.65";
process.env.MIN_MARKET_CAP_USD ??= "10000";
process.env.MAX_MARKET_CAP_USD ??= "500000";

process.env.VIRTUAL_POSITION_SIZE_USD ??= "10";
process.env.MAX_OPEN_POSITIONS ??= "2";
process.env.SIMULATED_BUY_SLIPPAGE_PERCENT ??= "3";
process.env.SIMULATED_SELL_SLIPPAGE_PERCENT ??= "5";
process.env.SIMULATED_FEE_PERCENT ??= "1";

process.env.STOP_LOSS_PERCENT ??= "18";
process.env.TAKE_PROFIT_PERCENT ??= "60";
process.env.TRAILING_STOP_PERCENT ??= "18";
process.env.MAX_HOLD_MINUTES ??= "20";
process.env.PRICE_STALE_MINUTES ??= "5";
process.env.REENTRY_COOLDOWN_MINUTES ??= "60";
process.env.RISK_MAX_ALLOWED_LEVEL ??= "MEDIUM";
