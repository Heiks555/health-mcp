const test = require('node:test');
const assert = require('node:assert/strict');

const { checkAndConsume } = require('../services/rateLimiter');

test('free tier allows exactly 3 requests per day then blocks', () => {
  const id = `test-user-${Date.now()}`;

  const first = checkAndConsume(id);
  const second = checkAndConsume(id);
  const third = checkAndConsume(id);
  const fourth = checkAndConsume(id);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, true);
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.remaining, 0);
});

test('different identifiers are tracked independently', () => {
  const idA = `test-user-a-${Date.now()}`;
  const idB = `test-user-b-${Date.now()}`;

  checkAndConsume(idA);
  checkAndConsume(idA);
  checkAndConsume(idA);
  assert.equal(checkAndConsume(idA).allowed, false);

  assert.equal(checkAndConsume(idB).allowed, true);
});
