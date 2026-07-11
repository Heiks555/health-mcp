const test = require('node:test');
const assert = require('node:assert/strict');

process.env.HEALTH_PROVIDER = 'openwearables';

const { createHealthProvider } = require('../services/healthProvider');

test('openwearables provider returns normalized health data', async () => {
  const provider = createHealthProvider();

  const health = await provider.getHealthStatus();
  assert.ok(health && typeof health === 'object');

  const sleep = await provider.getSleepData();
  assert.ok(typeof sleep.duration_hours === 'number');
  assert.ok(typeof sleep.deep_sleep_percentage === 'number');
  assert.ok(typeof sleep.rem_percentage === 'number');
  assert.ok(typeof sleep.hrv_ms === 'number' || sleep.hrv_ms === null);

  const activity = await provider.getActivityData();
  assert.ok(typeof activity.steps === 'number');
  assert.ok(typeof activity.calories_burned === 'number');

  const weekly = await provider.getWeeklySummary();
  assert.ok(Array.isArray(weekly));
  assert.ok(weekly.length >= 1);
});
