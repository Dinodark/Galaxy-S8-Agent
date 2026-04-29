/**
 * Оценка «на сколько дней хватит» по данным GET /api/v1/key (+ остаток из /credits в объекте status.openrouter).
 * Средний дневной расход: usage_weekly/7 → usage_monthly/30 → usage_daily.
 */

const MIN_BURN_USD = 1e-9;

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function estimateRemainingUsd(or) {
  if (!or || !or.ok) return null;
  if (
    or.account_credits_ok &&
    or.account_remaining != null &&
    or.account_remaining !== '' &&
    num(or.account_remaining) != null
  ) {
    return Math.max(0, num(or.account_remaining));
  }
  if (or.limit_remaining != null && or.limit_remaining !== '') {
    const lr = num(or.limit_remaining);
    if (lr != null) return Math.max(0, lr);
  }
  return null;
}

/**
 * @returns {{ burn: number, source: 'weekly' | 'monthly' | 'daily' } | null}
 */
function getDailyBurnEstimate(or) {
  if (!or || !or.ok) return null;
  const w = num(or.usage_weekly);
  if (w != null && w > 0) return { burn: w / 7, source: 'weekly' };
  const m = num(or.usage_monthly);
  if (m != null && m > 0) return { burn: m / 30, source: 'monthly' };
  const d = num(or.usage_daily);
  if (d != null && d > 0) return { burn: d, source: 'daily' };
  return null;
}

/**
 * @returns {{
 *   remainingUsd: number,
 *   burnPerDay: number,
 *   burnSource: 'weekly' | 'monthly' | 'daily',
 *   days: number,
 * } | null}
 */
function computeBudgetHorizon(or) {
  const remaining = estimateRemainingUsd(or);
  const burnInfo = getDailyBurnEstimate(or);
  if (remaining == null || burnInfo == null || burnInfo.burn < MIN_BURN_USD) {
    return null;
  }
  const days = remaining / burnInfo.burn;
  if (!Number.isFinite(days) || days < 0) return null;
  return {
    remainingUsd: remaining,
    burnPerDay: burnInfo.burn,
    burnSource: burnInfo.source,
    days,
  };
}

module.exports = {
  estimateRemainingUsd,
  getDailyBurnEstimate,
  computeBudgetHorizon,
};
