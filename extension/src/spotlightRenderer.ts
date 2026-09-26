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
  /** Anchor not found: outline the declared lines instead of spotlighting them. */
  stale: boolean;
}

const KINDS: StepKind[] = ["change", "context", "risk", "decision"];

/**
 * Badge colors (gutter number, inline card avatar). Mid-tones that read on both light and
 * dark backgrounds, matching the meaning of the contributed theme colors: green = change,
 * blue = context, amber = decision (needs the reviewer's judgement), red = risk.
 */
const GUTTER_COLORS: Record<StepKind, string> = {
  change: "#2da44e",
  context: "#2f81f7",
  risk: "#e5534b",
  decision: "#d29922",
};
const STALE_GUTTER_COLOR = "#8b949e";

/** Numbered, kind-colored circle as an image URI (gutter icon and inline card avatar). */
export function stepBadgeUri(stepNumber: number, kind: StepKind, stale = false): vscode.Uri {
  return gutterBadge(stepNumber, stale ? STALE_GUTTER_COLOR : GUTTER_COLORS[kind]);
}

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
  private staleType: vscode.TextEditorDecorationType | undefined;
  private gutterType: vscode.TextEditorDecorationType | undefined;
  private current: Spotlight | undefined;
  /** The one editor the step is drawn in, so a second view of the same file is not decorated. */
  private activeEditor: vscode.TextEditor | undefined;
  private applied = new Map<vscode.TextEditor, Map<vscode.TextEditorDecorationType, number>>();

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

  show(editor: vscode.TextEditor, range: vscode.Range, kind: StepKind, stepNumber: number, stale = false): void {
    this.clear();
    this.activeEditor = editor;
    this.current = { uri: editor.document.uri, range, kind, stepNumber, stale };
    this.gutterType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: stepBadgeUri(stepNumber, kind, stale),
      gutterIconSize: "contain",
    });
    this.apply(editor);
  }

  /** Re-applies the current step to the active editor when it becomes visible again. */
  redrawVisible(): void {
    if (!this.current) {
      return;
    }
    const editor = this.visibleEditorForStep();
    if (editor) {
      this.apply(editor);
    }
  }

  /** Removes every decoration this renderer owns from all visible editors. */
  clear(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      for (const type of this.allTypes()) {
        this.set(editor, type, []);
      }
    }
    this.gutterType?.dispose();
    this.gutterType = undefined;
    this.current = undefined;
    this.activeEditor = undefined;
    this.applied.clear();
  }

  /** The tracked editor while visible, otherwise whichever visible editor now shows the step. */
  private visibleEditorForStep(): vscode.TextEditor | undefined {
    const visible = vscode.window.visibleTextEditors;
    if (this.activeEditor && visible.includes(this.activeEditor)) {
      return this.activeEditor;
    }
    const uri = this.current?.uri.toString();
    this.activeEditor = uri === undefined ? undefined : visible.find((editor) => editor.document.uri.toString() === uri);
    return this.activeEditor;
  }

  dispose(): void {
    this.clear();
    this.disposeTypes();
  }

  private apply(editor: vscode.TextEditor): void {
    if (!this.current) {
      return;
    }
    const { range, kind, stale } = this.current;
    // A stale step would otherwise confidently spotlight the wrong code, so it only
    // gets a dashed outline and nothing else is dimmed.
    for (const [typeKind, type] of this.targetTypes) {
      this.set(editor, type, !stale && typeKind === kind ? [range] : []);
    }
    if (this.staleType) {
      this.set(editor, this.staleType, stale ? [range] : []);
    }
    if (this.gutterType) {
      this.set(editor, this.gutterType, [new vscode.Range(range.start, range.start)]);
    }
    if (this.dimType) {
      this.set(editor, this.dimType, stale ? [] : dimRanges(editor.document, range));
    }
  }

  /**
   * Number of decorated ranges this renderer currently has in each visible editor,
   * keyed by document path. Used by tests to prove cleanup; the API cannot read
   * decorations back.
   */
  appliedRanges(): Map<string, number> {
    const result = new Map<string, number>();
    for (const editor of vscode.window.visibleTextEditors) {
      const perType = this.applied.get(editor);
      const total = perType ? [...perType.values()].reduce((sum, n) => sum + n, 0) : 0;
      if (total > 0) {
        result.set(editor.document.uri.path, (result.get(editor.document.uri.path) ?? 0) + total);
      }
    }
    return result;
  }

  private set(editor: vscode.TextEditor, type: vscode.TextEditorDecorationType, ranges: vscode.Range[]): void {
    editor.setDecorations(type, ranges);
    let perType = this.applied.get(editor);
    if (!perType) {
      perType = new Map();
      this.applied.set(editor, perType);
    }
    perType.set(type, ranges.length);
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
    this.staleType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      borderStyle: "dashed",
      borderWidth: "0 0 0 2px",
      borderColor: new vscode.ThemeColor("agentTour.staleBorder"),
      overviewRulerColor: new vscode.ThemeColor("agentTour.staleBorder"),
      overviewRulerLane: vscode.OverviewRulerLane.Full,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    this.dimType = createDimType(this.options);
  }

  private allTypes(): vscode.TextEditorDecorationType[] {
    const types = [...this.targetTypes.values()];
    if (this.dimType) {
      types.push(this.dimType);
    }
    if (this.staleType) {
      types.push(this.staleType);
    }
    if (this.gutterType) {
      types.push(this.gutterType);
    }
    return types;
  }

  private disposeTypes(): void {
    // Disposing a type removes its decorations from every editor.
    for (const perType of this.applied.values()) {
      for (const type of this.targetTypes.values()) {
        perType.delete(type);
      }
      if (this.dimType) {
        perType.delete(this.dimType);
      }
      if (this.staleType) {
        perType.delete(this.staleType);
      }
    }
    for (const type of this.targetTypes.values()) {
      type.dispose();
    }
    this.targetTypes.clear();
    this.dimType?.dispose();
    this.dimType = undefined;
    this.staleType?.dispose();
    this.staleType = undefined;
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

function gutterBadge(stepNumber: number, color: string): vscode.Uri {
  const label = stepNumber > 99 ? "99+" : String(stepNumber);
  const fontSize = label.length > 1 ? 9 : 11;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
    `<circle cx="8" cy="8" r="7.5" fill="${color}"/>` +
    `<text x="8" y="8" dy="0.35em" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" ` +
    `font-size="${fontSize}" font-weight="700" fill="#ffffff">${label}</text></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}
