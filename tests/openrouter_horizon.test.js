const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeBudgetHorizon, getDailyBurnEstimate } = require('../core/openrouter_horizon');

const base = { ok: true, currency: 'USD' };

test('weekly burn: 7 USD / week → 1 USD/day, 10 USD left → ~10 days', () => {
  const or = {
    ...base,
    account_credits_ok: true,
    account_remaining: 10,
    usage_weekly: 7,
    usage_daily: 0,
  };
  const h = computeBudgetHorizon(or);
  assert.ok(h);
  assert.equal(h.burnSource, 'weekly');
  assert.ok(Math.abs(h.burnPerDay - 1) < 1e-9);
  assert.ok(Math.abs(h.days - 10) < 1e-9);
});

test('prefers weekly over monthly', () => {
  const or = {
    ...base,
    account_credits_ok: true,
    account_remaining: 14,
    usage_weekly: 7,
    usage_monthly: 100,
  };
  const b = getDailyBurnEstimate(or);
  assert.equal(b.source, 'weekly');
});

test('monthly when weekly zero', () => {
  const or = {
    ...base,
    account_credits_ok: true,
    account_remaining: 30,
    usage_weekly: 0,
    usage_monthly: 30,
  };
  const h = computeBudgetHorizon(or);
  assert.equal(h.burnSource, 'monthly');
  assert.ok(Math.abs(h.burnPerDay - 1) < 1e-9);
  assert.ok(Math.abs(h.days - 30) < 1e-9);
});

test('daily fallback', () => {
  const or = {
    ...base,
    account_credits_ok: true,
    account_remaining: 5,
    usage_weekly: 0,
    usage_monthly: 0,
    usage_daily: 1,
  };
  const h = computeBudgetHorizon(or);
  assert.equal(h.burnSource, 'daily');
  assert.equal(h.days, 5);
});

test('null when no burn', () => {
  const or = {
    ...base,
    account_credits_ok: true,
    account_remaining: 5,
    usage_weekly: 0,
    usage_monthly: 0,
    usage_daily: 0,
  };
  assert.equal(computeBudgetHorizon(or), null);
});

test('limit_remaining when no account credits', () => {
  const or = {
    ...base,
    account_credits_ok: false,
    account_remaining: null,
    limit_remaining: 3,
    usage_weekly: 7,
  };
  const h = computeBudgetHorizon(or);
  assert.ok(h);
  assert.equal(h.days, 3);
});
