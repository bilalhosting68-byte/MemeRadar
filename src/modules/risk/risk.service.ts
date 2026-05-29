import { env } from "../../config/env.js";
import { calculateBuyRatio, clamp } from "../../utils/math.js";
import type { RiskLevel } from "../../types/index.js";
import type { RiskComputation, RiskSignal } from "./risk.types.js";

export class RiskService {
  calculate(signal: RiskSignal): RiskComputation {
    const reasons: string[] = [];
    let score = 0;

    if (!signal.pairAddress) {
      score += 20;
      reasons.push("Pair address mancante");
    }

    if (!signal.tokenAddress) {
      score += 20;
      reasons.push("Token address mancante");
    }

    if (!signal.priceUsd || signal.priceUsd <= 0) {
      score += 20;
      reasons.push("Prezzo USD mancante o non valido");
    }

    if (signal.liquidityUsd === null || signal.liquidityUsd === undefined) {
      score += 15;
      reasons.push("Liquidita mancante");
    } else if (signal.liquidityUsd < env.MIN_LIQUIDITY_USD) {
      score += 25;
      reasons.push(`Liquidita sotto soglia: $${signal.liquidityUsd.toFixed(2)}`);
    }

    if (signal.volume5m === null || signal.volume5m === undefined) {
      score += 10;
      reasons.push("Volume 5m mancante");
    } else if (signal.volume5m < env.MIN_VOLUME_5M_USD) {
      score += 15;
      reasons.push(`Volume 5m basso: $${signal.volume5m.toFixed(2)}`);
    }

    const buyRatio = calculateBuyRatio(signal.buys5m, signal.sells5m);
    if (buyRatio === null) {
      score += 10;
      reasons.push("Buy/sell ratio 5m non calcolabile");
    } else if (buyRatio < env.MIN_BUY_RATIO) {
      score += 15;
      reasons.push(`Buy ratio debole: ${(buyRatio * 100).toFixed(1)}%`);
    }

    if (signal.marketCap === null || signal.marketCap === undefined) {
      score += 10;
      reasons.push("Market cap mancante");
    } else if (signal.marketCap < env.MIN_MARKET_CAP_USD) {
      score += 15;
      reasons.push(`Market cap troppo basso: $${signal.marketCap.toFixed(2)}`);
    } else if (signal.marketCap > env.MAX_MARKET_CAP_USD) {
      score += 12;
      reasons.push(`Market cap troppo alto: $${signal.marketCap.toFixed(2)}`);
    }

    if (!signal.pairCreatedAt) {
      score += 8;
      reasons.push("Eta pair mancante");
    } else {
      const ageMinutes = (Date.now() - signal.pairCreatedAt.getTime()) / 60_000;

      if (ageMinutes < 10) {
        score += 15;
        reasons.push(`Token molto nuovo: ${ageMinutes.toFixed(1)} minuti`);
      } else if (ageMinutes < 60) {
        score += 8;
        reasons.push(`Token recente: ${ageMinutes.toFixed(1)} minuti`);
      }
    }

    const finalScore = Math.round(clamp(score, 0, 100));

    return {
      score: finalScore,
      level: this.toRiskLevel(finalScore),
      reasons: reasons.length > 0 ? reasons : ["Nessuna penalita rilevante"],
    };
  }

  private toRiskLevel(score: number): RiskLevel {
    if (score <= 30) {
      return "LOW";
    }

    if (score <= 60) {
      return "MEDIUM";
    }

    if (score <= 80) {
      return "HIGH";
    }

    return "EXTREME";
  }
}
