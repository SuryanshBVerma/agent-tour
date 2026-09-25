# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through
GitHub: **Security → Report a vulnerability** on this repository (private vulnerability
reporting). Include steps to reproduce, the affected version, and your OS and VS Code
version. You should get an acknowledgement within a few working days.

## Supported versions

Only the latest release receives fixes.

## Threat model in brief

Tours are written by coding agents, so the extension and the validator treat tour content as
**untrusted input**:

- Step files are confined to the workspace after resolving symlinks and junctions.
- Card text renders without HTML, remote images or command links. The only commands a card
  can run are the extension's own Previous, Next and Stop.
- Start links accept only a validated tour id; paths and content are never read from a URI.
- The tour folder (`<temp>/agent-tours-<user>/`) must be private to the current user on
  POSIX systems, or it is refused.
- In untrusted workspaces, nothing starts automatically, and workspace settings cannot
  enable auto-start.
- The extension makes no network requests and collects no telemetry.

Reports that break any of these properties are in scope.
