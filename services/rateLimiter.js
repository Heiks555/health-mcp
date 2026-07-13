// Per-user daily request limits for the Claude proxy endpoints. In-memory and
// per-process by design: no real user accounts exist yet, so this just needs to stop
// runaway usage, not survive restarts. Resets naturally at UTC midnight since the
// counter key includes the calendar day.
//
// NOTE: state is per-instance. Fine on Railway's single instance today; if this ever
// scales to multiple instances, move this to a shared store (e.g. Redis).

const RATE_LIMIT_TIERS = Object.freeze({
  free: { requestsPerDay: 3 },
  paid: { requestsPerDay: 200 },
});

// Real tiering (tied to subscription status) comes later. Everyone is 'free' for now.
const DEFAULT_TIER = 'free';

const usage = new Map(); // identifier -> { day: 'YYYY-MM-DD', count: number }

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function secondsUntilNextUtcDay() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(1, Math.round((next.getTime() - now.getTime()) / 1000));
}

function getTierConfig(tierName) {
  return RATE_LIMIT_TIERS[tierName] || RATE_LIMIT_TIERS[DEFAULT_TIER];
}

function checkAndConsume(identifier, tierName = DEFAULT_TIER) {
  const tier = getTierConfig(tierName);
  const day = todayKey();
  const existing = usage.get(identifier);
  const entry = existing && existing.day === day ? existing : { day, count: 0 };

  if (entry.count >= tier.requestsPerDay) {
    usage.set(identifier, entry);
    return { allowed: false, remaining: 0, limit: tier.requestsPerDay };
  }

  entry.count += 1;
  usage.set(identifier, entry);
  return { allowed: true, remaining: tier.requestsPerDay - entry.count, limit: tier.requestsPerDay };
}

module.exports = {
  checkAndConsume,
  secondsUntilNextUtcDay,
  RATE_LIMIT_TIERS,
  DEFAULT_TIER,
};
