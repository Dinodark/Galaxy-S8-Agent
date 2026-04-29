/** USD: `/key` — лимиты ключа; `/credits` — баланс аккаунта (куплено − списано). */

import { computeBudgetHorizon } from '../../core/openrouter_horizon.js';

export function formatUsd(value) {
  if (value === null || value === undefined || value === '') return null;
  const x = Number(value);
  if (Number.isNaN(x)) return String(value);
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(x);
}

/**
 * Главная цифра: остаток на аккаунте (GET /credits), иначе остаток по лимиту ключа (GET /key).
 */
export function formatBalanceMain(or) {
  if (!or || !or.ok) return '—';
  if (
    or.account_credits_ok &&
    or.account_remaining != null &&
    Number.isFinite(Number(or.account_remaining))
  ) {
    return formatUsd(or.account_remaining);
  }
  if (or.limit_remaining == null) {
    return 'без лимита';
  }
  return formatUsd(or.limit_remaining) ?? '—';
}

/**
 * Одна строка: при каком темпе и на сколько дней хватит остатка (кошелёк или limit_remaining).
 */
export function formatBudgetHorizon(or) {
  const h = computeBudgetHorizon(or);
  if (!h) return null;
  const burnFmt = formatUsd(h.burnPerDay);
  if (!burnFmt) return null;

  const srcLabel =
    h.burnSource === 'weekly'
      ? 'среднее за 7 дней'
      : h.burnSource === 'monthly'
        ? 'среднее за 30 дней'
        : 'по расходу за сегодня';

  const { days } = h;
  if (days >= 365 * 8) {
    return `при ~${burnFmt}/день (${srcLabel}) запаса хватит очень надолго`;
  }
  if (days >= 60) {
    return `при ~${burnFmt}/день (${srcLabel}) хватит ~${Math.round(days)} дн.`;
  }
  if (days >= 1) {
    const rounded = days >= 10 ? Math.round(days) : Math.round(days * 10) / 10;
    return `при ~${burnFmt}/день (${srcLabel}) хватит ~${rounded} дн.`;
  }
  const hours = Math.max(1, Math.round(days * 24));
  return `при ~${burnFmt}/день (${srcLabel}) хватит ~${hours} ч`;
}

/** Подпись: горизонт бюджета, расход за сегодня; если /credits недоступен — пояснение. */
export function formatBalanceSubtitle(or) {
  if (!or || !or.ok) return null;
  const parts = [];
  const horizon = formatBudgetHorizon(or);
  if (horizon) parts.push(horizon);
  if (or.usage_daily != null && or.usage_daily !== '') {
    const u = formatUsd(or.usage_daily);
    if (u) parts.push(`расход ключа сегодня ${u}`);
  }
  if (!or.account_credits_ok && or.account_credits_message) {
    parts.push(`аккаунт OpenRouter: ${or.account_credits_message}`);
  }
  if (or.byok_usage_daily != null && Number(or.byok_usage_daily) > 0) {
    const b = formatUsd(or.byok_usage_daily);
    if (b) parts.push(`BYOK за день ${b}`);
  }
  return parts.length ? parts.join(' · ') : null;
}
