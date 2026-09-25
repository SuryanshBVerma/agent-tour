import * as vscode from "vscode";
import { StepKind } from "./types";

export type DimMode = "opacity" | "wash" | "off";

export interface SpotlightOptions {
  dimMode: DimMode;
  dimOpacity: number;
}

interface Spotlight {
  uri: vscode.Uri;
  /** 0-based, whole-line range of the step. */
  range: vscode.Range;
  kind: StepKind;
  stepNumber: number;
}

const KINDS: StepKind[] = ["change", "context", "risk", "decision"];

/** Gutter badge colors; mid-tones chosen to read on both light and dark gutters. */
const GUTTER_COLORS: Record<StepKind, string> = {
  change: "#2da44e",
  context: "#2f81f7",
  risk: "#e5534b",
  decision: "#986ee2",
};

/**
 * Draws the current step: tinted, bordered target lines, a numbered gutter badge,
 * an overview-ruler mark, and dimming for everything outside the step.
 *
 * `dimMode: "opacity"` injects CSS through `textDecoration`. That is undocumented
 * VS Code behavior and may break on update, so it stays isolated here and can be
 * switched to the "wash" fallback via the `agentTour.dimMode` setting.
 */
export class SpotlightRenderer implements vscode.Disposable {
  private targetTypes = new Map<StepKind, vscode.TextEditorDecorationType>();
  private dimType: vscode.TextEditorDecorationType | undefined;
  private gutterType: vscode.TextEditorDecorationType | undefined;
  private current: Spotlight | undefined;

  constructor(private options: SpotlightOptions) {
    this.createStaticTypes();
  }

  /** Rebuilds decoration types after a settings change and redraws the current step. */
  configure(options: SpotlightOptions): void {
    this.options = options;
    this.disposeTypes();
    this.createStaticTypes();
    this.redrawVisible();
  }

  show(editor: vscode.TextEditor, range: vscode.Range, kind: StepKind, stepNumber: number): void {
    this.clear();
    this.current = { uri: editor.document.uri, range, kind, stepNumber };
    this.gutterType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: gutterBadge(stepNumber, kind),
      gutterIconSize: "contain",
    });
    this.apply(editor);
  }

  /** Re-applies the current step to editors that became visible again (e.g. file reopened). */
  redrawVisible(): void {
    if (!this.current) {
      return;
    }
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === this.current.uri.toString()) {
        this.apply(editor);
      }
    }
  }

  /** Removes every decoration this renderer owns from all visible editors. */
  clear(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      for (const type of this.allTypes()) {
        editor.setDecorations(type, []);
      }
    }
    this.gutterType?.dispose();
    this.gutterType = undefined;
    this.current = undefined;
  }

  dispose(): void {
    this.clear();
    this.disposeTypes();
  }

  private apply(editor: vscode.TextEditor): void {
    if (!this.current) {
      return;
    }
    const { range, kind } = this.current;
    for (const [typeKind, type] of this.targetTypes) {
      editor.setDecorations(type, typeKind === kind ? [range] : []);
    }
    if (this.gutterType) {
      editor.setDecorations(this.gutterType, [new vscode.Range(range.start, range.start)]);
    }
    if (this.dimType) {
      editor.setDecorations(this.dimType, dimRanges(editor.document, range));
    }
  }

  private createStaticTypes(): void {
    for (const kind of KINDS) {
      this.targetTypes.set(
        kind,
        vscode.window.createTextEditorDecorationType({
          isWholeLine: true,
          backgroundColor: new vscode.ThemeColor(`agentTour.${kind}Background`),
          borderStyle: "solid",
          borderWidth: "0 0 0 3px",
          borderColor: new vscode.ThemeColor(`agentTour.${kind}Border`),
          overviewRulerColor: new vscode.ThemeColor(`agentTour.${kind}Border`),
          overviewRulerLane: vscode.OverviewRulerLane.Full,
          rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        }),
      );
    }
    this.dimType = createDimType(this.options);
  }

  private allTypes(): vscode.TextEditorDecorationType[] {
    const types = [...this.targetTypes.values()];
    if (this.dimType) {
      types.push(this.dimType);
    }
    if (this.gutterType) {
      types.push(this.gutterType);
    }
    return types;
  }

  private disposeTypes(): void {
    for (const type of this.targetTypes.values()) {
      type.dispose();
    }
    this.targetTypes.clear();
    this.dimType?.dispose();
    this.dimType = undefined;
  }
}

function createDimType(options: SpotlightOptions): vscode.TextEditorDecorationType | undefined {
  switch (options.dimMode) {
    case "opacity": {
      // The value comes from settings, which a workspace can override. Clamping to a
      // number keeps arbitrary CSS from being injected through this string.
      const opacity = clampOpacity(options.dimOpacity);
      return vscode.window.createTextEditorDecorationType({
        textDecoration: `none; opacity: ${opacity}`,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      });
    }
    case "wash":
      return vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: new vscode.ThemeColor("agentTour.dimWash"),
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      });
    case "off":
      return undefined;
  }
}

export function clampOpacity(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0.35;
  return Math.round(Math.min(1, Math.max(0.05, n)) * 100) / 100;
}

/** Ranges covering all text above and below the target lines. */
export function dimRanges(document: vscode.TextDocument, target: vscode.Range): vscode.Range[] {
  const ranges: vscode.Range[] = [];
  if (target.start.line > 0) {
    const lastAbove = document.lineAt(target.start.line - 1);
    ranges.push(new vscode.Range(0, 0, lastAbove.lineNumber, lastAbove.range.end.character));
  }
  if (target.end.line < document.lineCount - 1) {
    const lastLine = document.lineAt(document.lineCount - 1);
    ranges.push(
      new vscode.Range(target.end.line + 1, 0, lastLine.lineNumber, lastLine.range.end.character),
    );
  }
  return ranges;
}

function gutterBadge(stepNumber: number, kind: StepKind): vscode.Uri {
  const label = stepNumber > 99 ? "99+" : String(stepNumber);
  const fontSize = label.length > 1 ? 9 : 11;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
    `<circle cx="8" cy="8" r="7.5" fill="${GUTTER_COLORS[kind]}"/>` +
    `<text x="8" y="8" dy="0.35em" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" ` +
    `font-size="${fontSize}" font-weight="700" fill="#ffffff">${label}</text></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}
