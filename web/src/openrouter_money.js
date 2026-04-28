/** USD: `/key` — лимиты ключа; `/credits` — баланс аккаунта (куплено − списано). */

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

/** Подпись: расход за день по ключу, остаток по лимиту ключа; если /credits недоступен — пояснение. */
export function formatBalanceSubtitle(or) {
  if (!or || !or.ok) return null;
  const parts = [];
  if (or.usage_daily != null && or.usage_daily !== '') {
    const u = formatUsd(or.usage_daily);
    if (u) parts.push(`расход ключа за день ${u}`);
  }
  if (or.account_credits_ok && or.limit_remaining != null && or.limit_remaining !== '') {
    const kr = formatUsd(or.limit_remaining);
    if (kr) parts.push(`ещё по лимиту ключа ${kr}`);
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
