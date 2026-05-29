import type { SignalDecisionType } from "../../types/index.js";

export interface PaperTradeDecision {
  decision: SignalDecisionType;
  action: string;
  opened: boolean;
  skipped: boolean;
  passedFilters: boolean;
  reasons: string[];
  positionId?: string;
}

export interface EntryFilterEvaluation {
  passed: boolean;
  reasons: string[];
}
