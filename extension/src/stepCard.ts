import * as vscode from "vscode";
import { Resolution, formatDelta } from "./anchorResolver";
import { KIND_LABELS, StepKind, Tour } from "./types";

/** The only commands a step card may invoke. Anything else in card Markdown is inert. */
export const CARD_COMMANDS = [
  "agentTour.previous",
  "agentTour.next",
  "agentTour.stop",
] as const;

export const KIND_ICONS: Record<StepKind, string> = {
  change: "$(diff-modified)",
  context: "$(info)",
  risk: "$(warning)",
  decision: "$(question)",
};

/**
 * A rendered card, split by trust level:
 * - `header` is built only from our own fixed strings and numbers, so it alone may use
 *   HTML (for the colored kind badge).
 * - `body` holds the agent-written title and description: no HTML, no commands.
 * - `footer` holds the navigation links: commands limited to CARD_COMMANDS, no HTML.
 */
export interface CardParts {
  header: vscode.MarkdownString;
  body: vscode.MarkdownString;
  footer: vscode.MarkdownString;
  /** Plain-text header for places that cannot render Markdown (inline card label). */
  label: string;
}

interface ActiveCard {
  uri: vscode.Uri;
  range: vscode.Range;
  parts: CardParts;
}

/**
 * Serves the step card through a HoverProvider (`agentTour.cardStyle: "hover"`). It answers
 * only while a tour is active and only inside the current step, so it never adds noise to
 * normal hovers.
 */
export class StepCard implements vscode.HoverProvider, vscode.Disposable {
  private active: ActiveCard | undefined;
  private readonly registration: vscode.Disposable;

  constructor(private readonly log: vscode.LogOutputChannel) {
    this.registration = vscode.languages.registerHoverProvider({ scheme: "file" }, this);
  }

  set(uri: vscode.Uri, range: vscode.Range, parts: CardParts): void {
    this.active = { uri, range, parts };
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
    const { header, body, footer } = card.parts;
    return new vscode.Hover([header, body, footer], card.range);
  }

  dispose(): void {
    this.registration.dispose();
    this.active = undefined;
  }
}

export function renderCard(tour: Tour, index: number, resolution: Resolution): CardParts {
  const step = tour.steps[index];
  const total = tour.steps.length;
  const kindLabel = KIND_LABELS[step.kind];

  // Header: our strings only. VS Code's sanitizer keeps <span style> when the style is
  // exactly `color:...;background-color:...;` with hex or --vscode-* variables, so the
  // badge follows the theme through the colors this extension contributes.
  const header = new vscode.MarkdownString(undefined, true);
  header.supportHtml = true;
  header.isTrusted = false;
  header.appendMarkdown(`**Step ${index + 1} of ${total}** &nbsp; ${badge(`${KIND_ICONS[step.kind]} ${kindLabel}`, `agentTour-${step.kind}Border`)}`);
  if (resolution.status === "stale") {
    header.appendMarkdown(` &nbsp; ${badge("$(alert) Stale", "agentTour-staleBorder")} _code changed since the tour was written_`);
  } else if (resolution.status === "relocated") {
    header.appendMarkdown(` &nbsp; $(arrow-swap) _moved ${formatDelta(resolution.delta)}_`);
  }

  // Body: agent-written, fully untrusted.
  const body = new vscode.MarkdownString();
  body.supportHtml = false;
  body.isTrusted = false;
  body.appendMarkdown(`### ${escapeInline(step.title)}\n\n${sanitizeDescription(step.description)}`);

  // Footer: navigation only.
  const footer = new vscode.MarkdownString(undefined, true);
  footer.supportHtml = false;
  footer.isTrusted = { enabledCommands: [...CARD_COMMANDS] };
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
  footer.appendMarkdown(links.join(" &nbsp;·&nbsp; "));

  const status = resolution.status === "stale" ? " · Stale" : "";
  return { header, body, footer, label: `Step ${index + 1} of ${total} · ${kindLabel}${status}` };
}

/** A colored pill. `colorVariable` is a contributed color id with dots written as dashes. */
function badge(text: string, colorVariable: string): string {
  return (
    `<span style="color:var(--vscode-editor-background);background-color:var(--vscode-${colorVariable});">` +
    `&nbsp;${text}&nbsp;</span>`
  );
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
export function escapeInline(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/([\\*_[\]<>#!|])/g, "\\$1");
}
