import * as vscode from "vscode";
import { KIND_LABELS, Tour } from "./types";

/**
 * Persistent status bar controls. The hover card dismisses easily, so progress and
 * navigation must stay reachable here.
 */
export class ControlBar implements vscode.Disposable {
  private readonly previous: vscode.StatusBarItem;
  private readonly label: vscode.StatusBarItem;
  private readonly next: vscode.StatusBarItem;
  private readonly stop: vscode.StatusBarItem;

  constructor() {
    const priority = 1000;
    this.previous = vscode.window.createStatusBarItem("agentTour.previous", vscode.StatusBarAlignment.Left, priority + 3);
    this.label = vscode.window.createStatusBarItem("agentTour.label", vscode.StatusBarAlignment.Left, priority + 2);
    this.next = vscode.window.createStatusBarItem("agentTour.next", vscode.StatusBarAlignment.Left, priority + 1);
    this.stop = vscode.window.createStatusBarItem("agentTour.stop", vscode.StatusBarAlignment.Left, priority);

    for (const item of this.items()) {
      item.name = "Agent Tour";
    }
    this.previous.text = "$(chevron-left)";
    this.previous.tooltip = "Previous step (Alt+[)";
    this.previous.command = "agentTour.previous";
    this.label.command = "agentTour.showCard";
    this.next.command = "agentTour.next";
    this.stop.text = "$(close)";
    this.stop.tooltip = "Stop tour (Esc)";
    this.stop.command = "agentTour.stop";
  }

  update(tour: Tour, index: number): void {
    const step = tour.steps[index];
    const last = index === tour.steps.length - 1;
    this.label.text = `$(map) ${index + 1}/${tour.steps.length} · ${KIND_LABELS[step.kind]}: ${step.title}`;
    this.label.tooltip = `${tour.title}. Click to show the step card (Alt+H).`;
    this.next.text = last ? "$(check)" : "$(chevron-right)";
    this.next.tooltip = last ? "Finish tour (Alt+])" : "Next step (Alt+])";
    if (index > 0) {
      this.previous.show();
    } else {
      this.previous.hide();
    }
    this.label.show();
    this.next.show();
    this.stop.show();
  }

  hide(): void {
    for (const item of this.items()) {
      item.hide();
    }
  }

  dispose(): void {
    for (const item of this.items()) {
      item.dispose();
    }
  }

  private items(): vscode.StatusBarItem[] {
    return [this.previous, this.label, this.next, this.stop];
  }
}
