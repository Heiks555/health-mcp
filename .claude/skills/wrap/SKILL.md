---
name: wrap
description: End-of-session — update AGENTS.md with what we learned this session, prune it, then commit and push. Use when the user says wrap, wrap up, or is ending a work session.
---

Wrap up this session.

1. Look back over this session. Identify anything expensive for a future session to
   rediscover: a non-obvious constraint, a bug whose root cause took real effort to
   find, a decision and its reasoning, a changed URL or key name. Ignore routine work.

2. Update AGENTS.md with those findings, then PRUNE it:
   - delete anything obsolete or superseded
   - merge duplicates, cut filler
   - HARD CEILING: 80 lines. If it exceeds that, cut the least valuable entries until
     it fits. A bloated AGENTS.md burns context every session and gets ignored.

3. Show me a one-line summary of what you added and removed.

4. git add, commit with a message describing this session's work, and push.
