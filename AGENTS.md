# health-mcp — MCP server for Suund

Exposes Open Wearables health data to claude.ai as MCP tools, so Claude can read and
reason over real wearable data in conversation.

## Architecture

Open Wearables (self-hosted, Railway) → this server → claude.ai (Connectors → "Health MCP")

OW backend:  https://backend-production-21d7.up.railway.app
This server: https://health-mcp-production.up.railway.app
Sibling repo: github.com/Heiks555/suund-app (the Expo app)

## Layout

index.js                    MCP server + transport + tool registration
services/healthProvider.js  ALL data access — OW fetch + mock fallback
test/                       node --test

## Tools exposed

get_health_status, get_sleep_data, get_activity_data,
get_nutrition_data (still mocked — OW has no nutrition source), get_weekly_summary

## Claude API proxy (for the Suund app)

The Expo app used to call api.anthropic.com directly with EXPO_PUBLIC_ANTHROPIC_API_KEY,
which ships the key inside the app bundle. That's gone — the app must now call this
server instead:

- POST /api/analyze — one-shot health summary. Body: `{ healthData }`. Returns
  `{ summary, tags }`.
- POST /api/chat — conversational follow-up. Body: `{ healthData, messages }` where
  messages is `[{ role: 'user'|'assistant', content }]`. Returns `{ message }`.

Both require headers `X-Suund-App-Key` (must equal SUUND_APP_KEY — an app-level gate,
not real user auth) and `X-Suund-User-Id` (a stable anonymous id the app generates and
persists, used only for per-user rate limiting until real accounts exist).

Logic lives in services/claudeProxy.js (system prompts, Anthropic call, tag parsing —
ported from the app's old claudeService.ts) and services/rateLimiter.js (in-memory,
resets at UTC midnight, currently one hardcoded 'free' tier at 3 requests/day). Rate
limit state is per-process — fine on Railway's single instance, would need a shared
store if this ever scales out.

## CRITICAL: MCP transport pattern

Create a FRESH McpServer + StreamableHTTPServerTransport pair PER REQUEST.

A shared transport works for the first `initialize` call, then returns 500 on every
subsequent request. claude.ai reports this as "This connector's server is currently
unavailable" — which looks like the server is down, but it is running fine. This cost
hours to diagnose. Do not "simplify" it back.

## Railway rules

- GET /health must return JSON. Without it Railway marks the service failed. The MCP
  endpoint itself returns 406 to a plain GET — that is correct, not an error.
- Env vars require a manual redeploy. Adding a variable does nothing until Deploy is clicked.
- Required env: OW_API_KEY, HEALTH_PROVIDER=openwearables

## Non-negotiable rules

1. Provider abstraction stays swappable: 'openwearables' | 'mock' via HEALTH_PROVIDER,
   with graceful fallback if OW is unreachable. OW is early-stage software.
2. Never hardcode secrets. API key from process.env.OW_API_KEY only.
   Header: X-Open-Wearables-API-Key
3. Missing values must be explicit, not silently zero — Claude correctly flagged a real
   data gap once because zeros were distinguishable from nulls.

## Owner context

Solo founder, operations background, does not write code by hand. Claude Code writes;
the owner directs, tests, decides. Prefers large prompts that complete a whole chunk.
Explain what changed and why, not line-by-line diffs.

## Workflow

git pull before starting, git push when a chunk works — Railway auto-deploys on push.
Two machines share this repo.
