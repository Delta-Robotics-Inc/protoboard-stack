# Security policy

## Reporting a vulnerability

Please report security problems privately, never in a public issue, pull
request or discussion.

Use GitHub's private vulnerability reporting: on this repository's
**Security** tab, press **Report a vulnerability**
(https://github.com/Delta-Robotics-Inc/protoboard-stack/security/advisories/new).
Only the maintainers see the report.

Say what is affected (the npm package, the VS Code extension, the MCP server
or the command line), how to reproduce it, and what an attacker could do with
it. The output of `protoboard --version --json` says which build you ran.

We acknowledge a report within five working days, keep you informed while we
fix it, and credit you in the advisory unless you would rather we did not.
Please give us a reasonable time to release a fix before you disclose it.

## Supported versions

Fixes go into the newest release. Update to it: the extension updates itself
from the Marketplace or Open VSX, and `npm i -g @protoboardai/cli` updates the
command line.

## Scope

This repository: the `@protoboardai/*` npm packages, the Protoboard VS Code
extension and the `protoboard-stack` MCP server. UHD and the UHD viewer have
their own repositories and policies. The hosted Protoboard library is run by
Delta Robotics; report problems with it the same way, here.
