export type StepKind = "change" | "context" | "risk" | "decision";

export interface TourStep {
  /** Workspace-relative path. Absolute paths and `..` segments are rejected. */
  file: string;
  /** 1-based, inclusive line range. */
  range: { start: number; end: number };
  /** Exact snippet from the first meaningful line of the range. */
  anchor: string;
  kind: StepKind;
  title: string;
  /** Markdown. Rendered without HTML; only this extension's commands are trusted. */
  description: string;
}

export interface Tour {
  version: 1;
  id: string;
  title: string;
  summary: string;
  baseRef: string;
  createdBy: string;
  steps: TourStep[];
}

export const TOUR_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}$/;

export const KIND_LABELS: Record<StepKind, string> = {
  change: "Change",
  context: "Context",
  risk: "Risk",
  decision: "Decision",
};
