/** Поля лимита/расхода с OpenRouter GET /api/v1/key — суммы в USD. */

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

/** Остаток лимита по ключу (limit_remaining); null от API = без лимита по расходам. */
export function formatBalanceMain(or) {
  if (!or || !or.ok) return '—';
  if (or.limit_remaining == null) {
    return 'без лимита';
  }
  return formatUsd(or.limit_remaining) ?? '—';
}

/** Вторая строка: расход за день и при необходимости лимит и BYOK. */
export function formatBalanceSubtitle(or) {
  if (!or || !or.ok) return null;
  const parts = [];
  if (or.usage_daily != null && or.usage_daily !== '') {
    const u = formatUsd(or.usage_daily);
    if (u) parts.push(`расход за день ${u}`);
  }
  if (or.limit != null && or.limit !== '') {
    const lim = formatUsd(or.limit);
    if (lim) parts.push(`лимит ${lim}`);
  }
  if (or.byok_usage_daily != null && Number(or.byok_usage_daily) > 0) {
    const b = formatUsd(or.byok_usage_daily);
    if (b) parts.push(`BYOK за день ${b}`);
  }
  return parts.length ? parts.join(' · ') : null;
}
