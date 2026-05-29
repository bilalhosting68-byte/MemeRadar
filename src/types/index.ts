export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";

export type PositionStatus = "OPEN" | "CLOSED";

export type SignalDecisionType = "OPENED" | "SKIPPED";

export type PaperCloseReason =
  | "STOP_LOSS"
  | "TAKE_PROFIT"
  | "TRAILING_STOP"
  | "MAX_HOLD"
  | "PRICE_STALE"
  | "MANUAL";

export type JsonRecord = Record<string, unknown>;
