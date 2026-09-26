# Historical cross-team coordination

These team status files are records from the stopped agents. New chats should begin with [the current product brief](../product/overview.md) and [build status](../integration/status.md).

The authoritative workstream and verification rules are in [the protocol](../integration/protocol.md). Each primary owns its own `team-N.md` status and request directory; no one edits another team's status file.

Before integration or a dependency handoff, inspect the current main branch and all three status files. Record the worktree branch and SHA, contract version, capabilities, checks and actual outcomes, next task, blockers and exact cross-owner requests. A request names the affected API/files, exact change, reason, compatibility effect and validation. The target owner acknowledges it in their own status file.

Work in isolated Git worktrees, keep ownership boundaries, integrate verified changes with ordinary merges and pushes, and never force-push. A subagent's return is a proposal until its primary inspects the diff and reruns relevant checks.
