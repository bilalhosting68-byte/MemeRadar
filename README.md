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
- Tracking metriche avanzate: posizioni totali, aperte, chiuse, winrate, PNL totale, PNL medio, biggest win, biggest loss, hold time medio, profit factor, drawdown virtuale massimo e PNL per close reason/risk level/market cap/liquidita.
- Logging decisionale compatto di default, con modalita dettagliata opzionale.
- Retry, rate limit e backoff per DexScreener.
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
cd MemeRadar
npm install
cp .env.example .env
```

## Configurazione `.env`

Valori principali:

```env
DATABASE_URL=postgresql://memeradar:memeradar@localhost:5432/memeradar?schema=public
DISCORD_WEBHOOK_URL=

SCAN_INTERVAL_SECONDS=15
POSITION_UPDATE_INTERVAL_SECONDS=15
METRICS_INTERVAL_MINUTES=5

MIN_LIQUIDITY_USD=15000
MIN_VOLUME_5M_USD=10000
MIN_BUY_RATIO=0.65
MIN_MARKET_CAP_USD=10000
MAX_MARKET_CAP_USD=500000

VIRTUAL_POSITION_SIZE_USD=10
MAX_OPEN_POSITIONS=2

SIMULATED_BUY_SLIPPAGE_PERCENT=3
SIMULATED_SELL_SLIPPAGE_PERCENT=5
SIMULATED_FEE_PERCENT=1

STOP_LOSS_PERCENT=18
TAKE_PROFIT_PERCENT=60
TRAILING_STOP_PERCENT=18
MAX_HOLD_MINUTES=20
PRICE_STALE_MINUTES=5
REENTRY_COOLDOWN_MINUTES=60

RISK_MAX_ALLOWED_LEVEL=MEDIUM

DEXSCREENER_MAX_TOKENS_PER_SCAN=20
DEXSCREENER_REQUEST_TIMEOUT_MS=10000
DEXSCREENER_MAX_RETRIES=3
DEXSCREENER_BASE_BACKOFF_MS=500
DEXSCREENER_MAX_BACKOFF_MS=8000
DEXSCREENER_PROFILE_MIN_REQUEST_INTERVAL_MS=1000
DEXSCREENER_PAIR_MIN_REQUEST_INTERVAL_MS=250

LOG_LEVEL=info
SIGNAL_DECISION_LOG_MODE=summary
```

`DISCORD_WEBHOOK_URL` puo restare vuoto: il bot funzionera comunque, saltando gli alert.

`SIGNAL_DECISION_LOG_MODE` controlla quanto sono verbosi i log dello scanner:

- `summary`: default consigliato, scrive un solo riassunto per ciclo scanner.
- `opened`: riassunto per ciclo piu dettaglio solo sulle aperture.
- `all`: dettaglio completo per ogni token, utile per debug ma genera log enormi.
- `none`: disattiva i log decisionali dello scanner, lasciando errori e metriche.

## Avvio PostgreSQL con Docker

```bash
docker compose up -d
```

Il database sara disponibile su `localhost:5432` con utente, password e database `memeradar`.

## Migrazioni Prisma

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
```

Per aprire Prisma Studio:

```bash
npm run prisma:studio
```

## Avvio bot

Sviluppo:

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

I test unitari coprono risk engine, filtri di ingresso del paper trading, slippage e fee, calcolo PNL, stop loss, take profit, trailing stop, max hold, price stale, persistenza `SignalDecision`, profit factor e max drawdown.

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

Contiene `ScannerService` e usa un adapter di discovery. Lo scanner fa polling periodico, recupera candidati Solana da DexScreener, normalizza i pair in `TokenSignalInput`, ignora chain diverse da Solana e usa `tokenAddress + pairAddress` per evitare duplicati.

Lo scanner trova nuovi token/pair e prende una decisione iniziale. Non e responsabile di aggiornare le posizioni gia aperte.

Endpoint DexScreener usati:

- `GET /token-profiles/latest/v1`
- `GET /token-boosts/latest/v1`
- `GET /tokens/v1/solana/{tokenAddresses}`
- `GET /latest/dex/pairs/solana/{pairAddress}`

L'adapter DexScreener applica limiter separati per endpoint: `token-profiles`/`token-boosts` usano `DEXSCREENER_PROFILE_MIN_REQUEST_INTERVAL_MS`, mentre `tokens`/`latest/dex/pairs` usano `DEXSCREENER_PAIR_MIN_REQUEST_INTERVAL_MS`. Restano attivi retry su `429` e `5xx`, rispetto di `Retry-After`, backoff esponenziale con jitter e timeout configurabile.

### `priceTracker`

Aggiorna periodicamente le posizioni aperte usando `pairAddress` e `tokenAddress`. Questo separa il ciclo di vita della posizione dal ciclo di discovery: una posizione puo essere aggiornata anche se il token non riappare nello scanner.

### `risk`

Calcola uno score da 0 a 100:

- `LOW`: 0-30
- `MEDIUM`: 31-60
- `HIGH`: 61-80
- `EXTREME`: 81-100

Le penalita includono liquidita bassa, volume 5m basso, buy/sell ratio debole, market cap fuori range, token troppo nuovo, dati mancanti, prezzo mancante e pair address mancante.

### `paperTrading`

Simula operazioni virtuali. Apre una posizione solo se:

- il rischio non e `EXTREME`;
- il livello e entro `RISK_MAX_ALLOWED_LEVEL`;
- liquidita, volume, buy ratio e market cap rispettano le soglie;
- non e gia aperta una posizione sullo stesso token/pair;
- il numero di posizioni aperte e sotto `MAX_OPEN_POSITIONS`;
- lo stesso token/pair non e stato chiuso negli ultimi `REENTRY_COOLDOWN_MINUTES`.

All'apertura applica slippage e fee simulate. Alla chiusura applica slippage e fee anche in uscita. Le chiusure possono avvenire per `STOP_LOSS`, `TAKE_PROFIT`, `TRAILING_STOP`, `MAX_HOLD` o `PRICE_STALE`.

Il paper trading non dipende dallo scanner per aggiornare i prezzi. Riceve i segnali per decidere eventuali aperture e riceve dal `priceTracker` i prezzi aggiornati delle posizioni aperte.

### `SignalDecision`

Ogni token analizzato produce una decisione persistita:

- `OPENED`: posizione paper aperta;
- `SKIPPED`: posizione non aperta.

La tabella salva `tokenSignalId`, decisione, motivi, risk score, risk level, esito dei filtri e timestamp. Questo rende auditabile il comportamento del bot anche quando i log sono compatti.

### `alerts`

Invia messaggi Discord tramite webhook. Se il webhook non e configurato, gli alert vengono saltati senza fermare il bot.

### `storage`

Espone Prisma tramite `DatabaseService` e centralizza operazioni su segnali, risk result, signal decision, paper position e bot event.

### `metrics`

Stampa periodicamente nei log le metriche del paper trading:

- total positions;
- open positions;
- closed positions;
- winrate;
- total virtual PNL;
- average PNL;
- biggest win;
- biggest loss;
- average hold time;
- profit factor;
- max drawdown virtuale;
- PNL per close reason;
- PNL per risk level;
- PNL per market cap range;
- PNL per liquidity range.

## Come leggere gli alert Discord

Nuovo segnale:

```text
🚨 New Meme Signal
Token: SYMBOL
Risk: MEDIUM - 48/100
Liquidity: $...
Volume 5m: $...
Buy/Sell 5m: ...
Market Cap: $...
Action: Paper trade opened / skipped
Link: DexScreener URL
```

Chiusura posizione:

```text
📈 Paper Position Closed
Token: SYMBOL
Entry: $...
Exit: $...
PNL: +...%
Reason: TAKE_PROFIT / STOP_LOSS / MAX_HOLD / TRAILING_STOP
```

Altri alert:

```text
🟢 Bot Started
🟩 Paper Position Opened
🔴 Critical Error
```

## Limiti dell'MVP

DexScreener e utile per un MVP read-only, ma non e una fonte completa per scoprire tutti i nuovi token o tutti i nuovi pool in tempo reale. Questa versione usa profili recenti e token boosted come candidati, poi interroga i pair associati. Alcuni launch possono non apparire o apparire in ritardo.

Il price tracker riduce la dipendenza dallo scanner per le posizioni gia aperte, ma resta vincolato alla disponibilita e freschezza dei dati DexScreener.

Per un radar piu completo serviranno fonti on-chain o API specializzate, ad esempio Birdeye, Helius, Pump.fun, Raydium listener o WebSocket.

## Roadmap futura

- Aggiungere Birdeye.
- Aggiungere Helius.
- Aggiungere listener Pump.fun/Raydium.
- Aggiungere dashboard web.
- Aggiungere AI scoring.
- Aggiungere wallet analytics.
- Aggiungere backtesting.
- Valutare trading reale solo dopo molti test, con massima cautela, separazione dei permessi, limiti rigorosi e audit del codice.

## Safety

MemeRadar MVP e paper trading only. Il codice non contiene wallet, private key, firma transazioni, swap o moduli per comprare/vendere token reali.
