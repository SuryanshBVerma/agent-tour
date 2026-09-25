import * as vscode from "vscode";
import { Resolution, formatDelta } from "./anchorResolver";
import { KIND_LABELS, StepKind, Tour, TourStep } from "./types";

/** The only commands a step card may invoke. Anything else in card Markdown is inert. */
export const CARD_COMMANDS = [
  "agentTour.previous",
  "agentTour.next",
  "agentTour.stop",
] as const;

const KIND_ICONS: Record<StepKind, string> = {
  change: "$(diff-modified)",
  context: "$(info)",
  risk: "$(warning)",
  decision: "$(law)",
};

interface ActiveCard {
  uri: vscode.Uri;
  range: vscode.Range;
  content: vscode.MarkdownString;
}

/**
 * Serves the step card through a HoverProvider. It answers only while a tour is active
 * and only for positions inside the current step, so it never adds noise to normal hovers.
 */
export class StepCard implements vscode.HoverProvider, vscode.Disposable {
  private active: ActiveCard | undefined;
  private readonly registration: vscode.Disposable;

  constructor(private readonly log: vscode.LogOutputChannel) {
    this.registration = vscode.languages.registerHoverProvider({ scheme: "file" }, this);
  }

  set(uri: vscode.Uri, range: vscode.Range, content: vscode.MarkdownString): void {
    this.active = { uri, range, content };
  }

  clear(): void {
    this.active = undefined;
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const card = this.active;
    if (!card || document.uri.toString() !== card.uri.toString() || !card.range.contains(position)) {
      return undefined;
    }
    this.log.trace(`Card served at ${position.line + 1}:${position.character + 1}`);
    return new vscode.Hover(card.content, card.range);
  }

  dispose(): void {
    this.registration.dispose();
    this.active = undefined;
  }
}

export function renderCard(tour: Tour, index: number, resolution: Resolution): vscode.MarkdownString {
  const step: TourStep = tour.steps[index];
  const total = tour.steps.length;
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = { enabledCommands: [...CARD_COMMANDS] };
  md.supportHtml = false;

  md.appendMarkdown(`**Step ${index + 1} of ${total}** · ${KIND_ICONS[step.kind]} ${KIND_LABELS[step.kind]}`);
  if (resolution.status === "stale") {
    md.appendMarkdown(" · $(alert) **Stale:** _code changed since the tour was written; showing the original lines_");
  } else if (resolution.status === "relocated") {
    md.appendMarkdown(` · $(arrow-swap) _moved ${formatDelta(resolution.delta)} since the tour was written_`);
  }
  md.appendMarkdown("\n\n");
  md.appendMarkdown(`### ${escapeInline(step.title)}\n\n`);
  md.appendMarkdown(`${sanitizeDescription(step.description)}\n\n`);
  md.appendMarkdown("---\n\n");

  const links: string[] = [];
  if (index > 0) {
    links.push("[$(chevron-left) Previous](command:agentTour.previous \"Previous step (Alt+[)\")");
  }
  links.push(
    index < total - 1
      ? "[Next $(chevron-right)](command:agentTour.next \"Next step (Alt+])\")"
      : "[Finish $(check)](command:agentTour.next \"Finish tour (Alt+])\")",
  );
  links.push("[Stop](command:agentTour.stop \"Stop tour (Esc)\")");
  md.appendMarkdown(links.join(" &nbsp;·&nbsp; "));
  return md;
}

/**
 * Descriptions are agent-written and untrusted. Images are neutralized so a card can
 * never trigger a network fetch; they degrade to ordinary click-only links.
 * HTML is already disabled via `supportHtml = false`.
 */
export function sanitizeDescription(text: string): string {
  return text.replace(/!\[/g, "\\![");
}

/**
 * Titles render inside a heading: keep them on one line and escape link, image and
 * emphasis syntax. Inline code (backticks) is allowed.
 */
function escapeInline(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/([\\*_[\]<>#!|])/g, "\\$1");
}
