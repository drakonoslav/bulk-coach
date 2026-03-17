import type { ApiProvenance } from "./workbook-types";

export type ColonyCoordRow = {
  rowIndex: number;
  metric: string | null;
  value: string | number | null;
  threshold: string | number | null;
  status: string | null;
  recommendation: string | null;
  confidence: string | null;
  raw: Record<string, unknown>;
};

export type DriftHistoryRow = {
  rowIndex: number;
  date: string | null;
  phase: string | null;
  driftType: string | null;
  driftSource: string | null;
  confidence: string | null;
  weightedDriftScore: number | null;
  watchFlag: string | null;
  raw: Record<string, unknown>;
};

export type ThresholdLabRow = {
  rowIndex: number;
  thresholdName: string | null;
  currentValue: string | number | null;
  suggestedValue: string | number | null;
  evidenceCount: number | null;
  notes: string | null;
  raw: Record<string, unknown>;
};

export type ColonyResponse = {
  colonyCoord: ColonyCoordRow[];
  driftHistory: DriftHistoryRow[];
  thresholdLab: ThresholdLabRow[];
  _provenance: ApiProvenance;
};
