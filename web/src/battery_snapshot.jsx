import React from 'react';

/** `battery` = fragment of `/api/status`: { enabled, lowThreshold, pollIntervalMs, sample } */
export function BatterySnapshotBlock({ battery, compact = false }) {
  if (!battery) return null;
  const sm = battery.sample;

  return (
    <div className={'battery-live' + (compact ? ' battery-live-compact' : '')}>
      {sm && sm.ok ? (
        <>
          <div className="battery-live-pct">{sm.percentage}%</div>
          <p className="battery-live-meta">
            <code>{sm.status || '—'}</code>
            <span className="muted"> · </span>
            {sm.charging ? 'зарядка' : 'от батареи'}
          </p>
        </>
      ) : (
        <p className="muted battery-live-error">
          {sm && sm.code === 'NO_TERMUX'
            ? 'На этом хосте нет Termux API (ожидается телефон с termux-battery-status).'
            : sm && sm.reason === 'unexpected_payload'
              ? 'Неожиданный ответ termux-battery-status.'
              : sm && sm.error
                ? sm.error
                : 'Нет данных о заряде.'}
        </p>
      )}
      {compact && (
        <p className="muted battery-live-hint">
          Полные параметры наблюдения (порог, интервал) — на вкладке Status → Сводка.
        </p>
      )}
    </div>
  );
}
