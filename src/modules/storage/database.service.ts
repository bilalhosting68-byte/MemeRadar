import { Prisma, PrismaClient } from "@prisma/client";
import type { PaperPosition, RiskResult, SignalDecision, TokenSignal } from "@prisma/client";
import type { TokenSignalInput } from "../scanner/scanner.types.js";
import type { RiskComputation } from "../risk/risk.types.js";
import type { PaperTradeDecision } from "../paperTrading/paperTrading.types.js";

export class DatabaseService {
  readonly prisma = new PrismaClient();

  async connect(): Promise<void> {
    await this.prisma.$connect();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async upsertTokenSignal(input: TokenSignalInput): Promise<{ signal: TokenSignal; created: boolean }> {
    const existing = await this.prisma.tokenSignal.findUnique({
      where: {
        tokenAddress_pairAddress: {
          tokenAddress: input.tokenAddress,
          pairAddress: input.pairAddress,
        },
      },
    });

    const data = {
      tokenAddress: input.tokenAddress,
      pairAddress: input.pairAddress,
      chain: input.chain,
      dex: input.dex,
      symbol: input.symbol,
      name: input.name,
      priceUsd: input.priceUsd,
      liquidityUsd: input.liquidityUsd,
      marketCap: input.marketCap,
      volume5m: input.volume5m,
      volume1h: input.volume1h,
      buys5m: input.buys5m,
      sells5m: input.sells5m,
      pairCreatedAt: input.pairCreatedAt,
      url: input.url,
      rawData: input.rawData as Prisma.InputJsonValue,
    };

    if (existing) {
      const signal = await this.prisma.tokenSignal.update({
        where: { id: existing.id },
        data,
      });

      return { signal, created: false };
    }

    const signal = await this.prisma.tokenSignal.create({ data });
    return { signal, created: true };
  }

  async createRiskResult(tokenSignalId: string, risk: RiskComputation): Promise<RiskResult> {
    return this.prisma.riskResult.create({
      data: {
        tokenSignalId,
        score: risk.score,
        level: risk.level,
        reasons: risk.reasons,
      },
    });
  }

  async createSignalDecision(
    tokenSignalId: string,
    decision: PaperTradeDecision,
    risk: RiskComputation,
  ): Promise<SignalDecision> {
    return this.prisma.signalDecision.create({
      data: {
        tokenSignalId,
        decision: decision.decision,
        reasons: decision.reasons,
        riskScore: risk.score,
        riskLevel: risk.level,
        passedFilters: decision.passedFilters,
      },
    });
  }

  async recordBotEvent(
    type: string,
    message: string,
    metadata: Prisma.InputJsonValue = {},
  ): Promise<void> {
    await this.prisma.botEvent.create({
      data: {
        type,
        message,
        metadata,
      },
    });
  }

  async countOpenPositions(): Promise<number> {
    return this.prisma.paperPosition.count({
      where: { status: "OPEN" },
    });
  }

  async findOpenPosition(tokenAddress: string, pairAddress: string): Promise<PaperPosition | null> {
    return this.prisma.paperPosition.findFirst({
      where: {
        tokenAddress,
        pairAddress,
        status: "OPEN",
      },
    });
  }

  async getOpenPositions(): Promise<PaperPosition[]> {
    return this.prisma.paperPosition.findMany({
      where: { status: "OPEN" },
      orderBy: { openedAt: "asc" },
    });
  }

  async createPaperPosition(data: Prisma.PaperPositionUncheckedCreateInput): Promise<PaperPosition> {
    return this.prisma.paperPosition.create({ data });
  }

  async updatePaperPosition(
    id: string,
    data: Prisma.PaperPositionUncheckedUpdateInput,
  ): Promise<PaperPosition> {
    return this.prisma.paperPosition.update({
      where: { id },
      data,
    });
  }
}
