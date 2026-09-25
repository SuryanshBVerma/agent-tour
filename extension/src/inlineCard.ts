import * as vscode from "vscode";
import { stepBadgeUri } from "./spotlightRenderer";
import { CardParts } from "./stepCard";
import { KIND_LABELS, StepKind } from "./types";

/**
 * The step card as an inline comment thread (`agentTour.cardStyle: "inline"`, the default).
 * Unlike a hover it stays open while the developer clicks around, and it sits directly
 * above the step. Navigation lives in the thread's title bar (see `comments/commentThread/title`
 * in package.json), and the body is the untrusted part of the card only: no HTML, no commands.
 */
export class InlineCard implements vscode.Disposable {
  private readonly controller: vscode.CommentController;
  private thread: vscode.CommentThread | undefined;

  constructor() {
    this.controller = vscode.comments.createCommentController("agentTour", "Agent Tour");
  }

  show(uri: vscode.Uri, range: vscode.Range, parts: CardParts, stepNumber: number, kind: StepKind, stale: boolean): void {
    this.clear();
    // Anchor on the line above the step so the card reads before the code it explains.
    const anchorLine = Math.max(range.start.line - 1, 0);
    const comment: vscode.Comment = {
      body: parts.body,
      mode: vscode.CommentMode.Preview,
      author: {
        name: stale ? `${KIND_LABELS[kind]} · stale` : KIND_LABELS[kind],
        iconPath: stepBadgeUri(stepNumber, kind, stale),
      },
      contextValue: "agentTour.step",
    };
    const thread = this.controller.createCommentThread(uri, new vscode.Range(anchorLine, 0, anchorLine, 0), [comment]);
    thread.label = parts.label;
    thread.canReply = false;
    thread.contextValue = "agentTour.step";
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    this.thread = thread;
  }

  /** Re-opens the card if the developer collapsed it. */
  expand(): void {
    if (this.thread) {
      this.thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    }
  }

  /** Where the card is anchored, for tests; undefined when no card is shown. */
  anchor(): { uri: vscode.Uri; line: number } | undefined {
    return this.thread ? { uri: this.thread.uri, line: this.thread.range?.start.line ?? 0 } : undefined;
  }

  clear(): void {
    this.thread?.dispose();
    this.thread = undefined;
  }

  dispose(): void {
    this.clear();
    this.controller.dispose();
  }
}
