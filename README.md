# MemeRadar

MemeRadar e un bot Node.js/TypeScript per monitorare memecoin su Solana, normalizzare segnali da fonti esterne, calcolare un risk score, simulare operazioni in paper trading e inviare alert leggibili su Discord.

Questa versione e una base modulare e professionale. Non e un trading bot reale.

## Cosa fa questa versione

- Scanner modulare con adapter DexScreener per trovare nuovi token/pair.
- Price tracker separato dallo scanner per aggiornare le posizioni aperte tramite `pairAddress` e `tokenAddress`.
- Normalizzazione di pair/token Solana in `TokenSignal`.
- Risk scoring deterministico da 0 a 100.
- Salvataggio di ogni decisione in `SignalDecision`: `OPENED` o `SKIPPED`.
- Salvataggio su PostgreSQL tramite Prisma.
- Paper trading realistico con slippage, fee, stop loss, take profit, trailing stop e max hold time.
- Metriche avanzate: winrate, PNL totale/medio, biggest win/loss, hold time medio, profit factor, max drawdown virtuale e PNL per close reason/risk level/market cap/liquidita.
- Logging decisionale dettagliato per ogni token analizzato.
- Retry, rate limit separato e backoff per DexScreener.
- Alert Discord per avvio bot, nuovi segnali, aperture, chiusure e errori critici.

## Cosa NON fa

- Non fa trading reale.
- Non usa wallet.
- Non usa private key.
- Non firma transazioni.
- Non compra e non vende token realmente.
- Non contiene moduli wallet.
- Non contiene codice per inviare swap o transazioni on-chain.
- Non usa Redis.
- Non ha frontend.
- Non usa AI.

## Installazione

Richiede Node.js 20+, Docker e Docker Compose.

```bash
npm install
cp .env.example .env
```

## Configurazione `.env`

```env
DATABASE_URL=postgresql://memeradar:memeradar@localhost:5432/memeradar?schema=public
DISCORD_WEBHOOK_URL=

SCAN_INTERVAL_SECONDS=15
POSITION_UPDATE_INTERVAL_SECONDS=15
METRICS_INTERVAL_MINUTES=5

MIN_LIQUIDITY_USD=10000
MIN_VOLUME_5M_USD=5000
MIN_BUY_RATIO=0.6
MIN_MARKET_CAP_USD=10000
MAX_MARKET_CAP_USD=500000

VIRTUAL_POSITION_SIZE_USD=10
MAX_OPEN_POSITIONS=3

SIMULATED_BUY_SLIPPAGE_PERCENT=3
SIMULATED_SELL_SLIPPAGE_PERCENT=5
SIMULATED_FEE_PERCENT=1

STOP_LOSS_PERCENT=25
TAKE_PROFIT_PERCENT=60
TRAILING_STOP_PERCENT=25
MAX_HOLD_MINUTES=30
PRICE_STALE_MINUTES=5

RISK_MAX_ALLOWED_LEVEL=MEDIUM

DEXSCREENER_MAX_TOKENS_PER_SCAN=20
DEXSCREENER_REQUEST_TIMEOUT_MS=10000
DEXSCREENER_MAX_RETRIES=3
DEXSCREENER_BASE_BACKOFF_MS=500
DEXSCREENER_MAX_BACKOFF_MS=8000
DEXSCREENER_PROFILE_MIN_REQUEST_INTERVAL_MS=1000
DEXSCREENER_PAIR_MIN_REQUEST_INTERVAL_MS=250

LOG_LEVEL=info
```

`DISCORD_WEBHOOK_URL` puo restare vuoto: il bot funzionera comunque, saltando gli alert.

## Avvio PostgreSQL

```bash
docker compose up -d
```

## Migrazioni Prisma

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
```

## Avvio bot

```bash
npm run dev
```

Produzione locale:

```bash
npm run build
npm start
```

## Test

```bash
npm run test
npm run typecheck
npm run build
```

I test unitari coprono risk engine, filtri di ingresso, slippage e fee, calcolo PNL, stop loss, take profit, trailing stop, max hold, price stale, persistenza `SignalDecision`, profit factor e max drawdown.

## Struttura File

```text
src/modules/scanner
src/modules/priceTracker
src/modules/risk
src/modules/paperTrading
src/modules/alerts
src/modules/storage
src/modules/metrics
```

## Moduli

### `scanner`

Trova nuovi token/pair, normalizza i dati in `TokenSignalInput`, ignora chain diverse da Solana e usa `tokenAddress + pairAddress` per evitare duplicati. Lo scanner decide solo sui nuovi segnali e non aggiorna le posizioni aperte.

Endpoint DexScreener usati:

- `GET /token-profiles/latest/v1`
- `GET /token-boosts/latest/v1`
- `GET /tokens/v1/solana/{tokenAddresses}`
- `GET /latest/dex/pairs/solana/{pairAddress}`

L'adapter DexScreener applica limiter separati: `token-profiles`/`token-boosts` usano `DEXSCREENER_PROFILE_MIN_REQUEST_INTERVAL_MS`, mentre `tokens`/`latest/dex/pairs` usano `DEXSCREENER_PAIR_MIN_REQUEST_INTERVAL_MS`. Restano attivi retry su `429` e `5xx`, rispetto di `Retry-After`, backoff esponenziale con jitter e timeout configurabile.

### `priceTracker`

Aggiorna periodicamente le posizioni aperte usando `pairAddress` e `tokenAddress`, anche quando il token non riappare nello scanner.

### `risk`

Calcola uno score da 0 a 100:

- `LOW`: 0-30
- `MEDIUM`: 31-60
- `HIGH`: 61-80
- `EXTREME`: 81-100

### `paperTrading`

Simula operazioni virtuali. Apre una posizione solo se il rischio e i filtri configurati sono accettabili. Applica slippage e fee in ingresso e uscita. Chiude per `STOP_LOSS`, `TAKE_PROFIT`, `TRAILING_STOP`, `MAX_HOLD` o `PRICE_STALE`.

### `SignalDecision`

Ogni token analizzato produce una decisione persistita:

- `OPENED`: posizione paper aperta.
- `SKIPPED`: posizione non aperta.

### `alerts`

Alert Discord principali:

```text
🟢 Bot Started
🚨 New Meme Signal
🟩 Paper Position Opened
📈 Paper Position Closed
🔴 Critical Error
```

### `metrics`

Stampa periodicamente metriche di paper trading: posizioni totali/aperta/chiuse, winrate, PNL, average hold time, profit factor, max drawdown virtuale e breakdown per close reason, risk level, market cap e liquidita.

## Limiti MVP

DexScreener e utile per un MVP read-only, ma non e una fonte completa per scoprire tutti i nuovi token o pool in tempo reale. Per un radar piu completo serviranno fonti come Birdeye, Helius, Pump.fun, Raydium listener o WebSocket.

## Roadmap futura

- Aggiungere Birdeye.
- Aggiungere Helius.
- Aggiungere listener Pump.fun/Raydium.
- Aggiungere dashboard web.
- Aggiungere AI scoring.
- Aggiungere wallet analytics.
- Aggiungere backtesting.
- Valutare trading reale solo dopo molti test, con massima cautela.

## Safety

MemeRadar MVP e paper trading only. Il codice non contiene wallet, private key, firma transazioni, swap o moduli per comprare/vendere token reali.
