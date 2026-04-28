import React, { useCallback, useEffect, useState } from 'react';
import { TriageLogView } from './triage_log.jsx';
import { JournalIngestLogView } from './journal_ingest_log.jsx';
import { BatterySnapshotBlock } from './battery_snapshot.jsx';
import { formatBalanceMain, formatUsd } from './openrouter_money.js';

function TabButton({ id, active, children, onClick }) {
  return (
    <button
      type="button"
      className={'settings-tab' + (active ? ' settings-tab-active' : '')}
      onClick={() => onClick(id)}
      role="tab"
      aria-selected={active}
    >
      {children}
    </button>
  );
}

function Row({ label, children }) {
  return (
    <div className="status-row">
      <span className="status-row-label">{label}</span>
      <span className="status-row-value">{children}</span>
    </div>
  );
}

function StatusOverview({ s }) {
  const dr = s.dailyReview || {};
  const st = s.stt || {};
  const next = dr.next;

  return (
    <div className="status-overview">
      <section className="card status-card">
        <h3 className="status-card-title">Режим и модель</h3>
        <div className="status-card-body">
          <Row label="Режим">{s.mode || '—'}</Row>
          <Row label="Модель (OpenRouter)">
            <code className="status-code">{s.model || '—'}</code>
          </Row>
          <Row label="Shell из чата">{s.allowShell ? 'разрешён' : 'выкл'}</Row>
        </div>
      </section>

      <section className="card status-card">
        <h3 className="status-card-title">Вечерняя сводка</h3>
        <div className="status-card-body">
          <Row label="Включена">{dr.enabled !== false ? 'да' : 'нет'}</Row>
          <Row label="Cron">
            <code className="status-code">{dr.cron || '—'}</code>
          </Row>
          <Row label="Часовой пояс">{dr.tz || 'по умолчанию системы'}</Row>
          <Row label="Следующий запуск">
            {next ? (
              <>
                {next.local}
                <span className="muted"> ({next.tz})</span>
              </>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Порог сообщений в журнале">{dr.minMessages ?? '—'}</Row>
          <Row label="Прошлых сводок в контексте">{dr.prevDays ?? '—'}</Row>
          <Row label="Модель сводки">
            <code className="status-code">{dr.model || s.model || '—'}</code>
          </Row>
          <Row label="Траж инбокса после сводки">{dr.inboxTriage !== false ? 'да' : 'нет'}</Row>
          <Row label="Макс. шагов тража">{dr.inboxTriageMaxSteps ?? '—'}</Row>
          <Row label="Инбокс только после успешных write_note">
            {dr.clearInboxOnlyAfterWrites !== false
              ? 'да'
              : 'нет — после тража всегда очищать (legacy)'}
          </Row>
        </div>
      </section>

      <section className="card status-card">
        <h3 className="status-card-title">Журнал и напоминания</h3>
        <div className="status-card-body">
          <Row label="Сегодня (дата)">{s.journal?.today || '—'}</Row>
          <Row label="Записей в журнале за сегодня">{s.journal?.entriesToday ?? '—'}</Row>
          <Row label="Активных напоминаний">{s.reminders?.pending ?? '—'}</Row>
        </div>
      </section>

      <section className="card status-card">
        <h3 className="status-card-title">OpenRouter</h3>
        <div className="status-card-body">
          {!s.openrouter?.ok ? (
            <Row label="Ключ">
              {s.openrouter?.error ||
                (s.openrouter?.httpStatus
                  ? `HTTP ${s.openrouter.httpStatus}`
                  : 'нет данных — проверьте OPENROUTER_API_KEY')}
            </Row>
          ) : (
            <>
              <Row label="Остаток средств (USD)">{formatBalanceMain(s.openrouter)}</Row>
              <Row label="Лимит ключа (USD)">
                {s.openrouter.limit != null && s.openrouter.limit !== ''
                  ? formatUsd(s.openrouter.limit) ?? '—'
                  : '—'}
              </Row>
              <Row label="Расход за день (USD)">
                {formatUsd(s.openrouter.usage_daily) ?? '—'}
              </Row>
              <Row label="Расход всего (USD)">{formatUsd(s.openrouter.usage) ?? '—'}</Row>
              {s.openrouter.label && (
                <Row label="Метка ключа">{String(s.openrouter.label)}</Row>
              )}
              <p className="muted status-footnote">
                Остаток и расход — в долларах США по данным{' '}
                <code>GET /api/v1/key</code> для текущего API-ключа. Значение «без лимита» —
                когда у ключа не задан потолок расходов (<code>limit_remaining</code> = null).
                Разбивка по одному запросу чата — в токенах после «Обработать день» в журнале.
              </p>
            </>
          )}
        </div>
      </section>

      <section className="card status-card">
        <h3 className="status-card-title">Голос (STT)</h3>
        <div className="status-card-body">
          <Row label="Состояние">
            {st.enabled
              ? 'активно'
              : st.configured && !st.hasGroqKey
                ? 'включено в настройках, но нет GROQ_API_KEY'
                : 'выключено'}
          </Row>
          <Row label="Язык">{st.language || '—'}</Row>
          <Row label="Модель">
            <code className="status-code">{st.model || '—'}</code>
          </Row>
          <Row label="Макс. длительность (с)">{st.maxDurationSec ?? '—'}</Row>
        </div>
      </section>

      <section className="card status-card">
        <h3 className="status-card-title">Батарея телефона</h3>
        <BatterySnapshotBlock battery={s.battery} />
        <div className="status-card-body status-battery-after-sample">
          <Row label="Наблюдение">{s.battery?.enabled ? 'вкл' : 'выкл'}</Row>
          {s.battery?.enabled && (
            <>
              <Row label="Порог предупреждения">{s.battery.lowThreshold}%</Row>
              <Row label="Интервал опроса (с)">
                {s.battery.pollIntervalMs != null
                  ? Math.round(s.battery.pollIntervalMs / 1000)
                  : '—'}
              </Row>
            </>
          )}
          <p className="muted status-footnote">
            Значение заряда запрашивается при загрузке этой страницы через{' '}
            <code>termux-battery-status</code> (Telegram-бот на том же телефоне в Termux).
          </p>
        </div>
      </section>
    </div>
  );
}

export function StatusPanel({ api }) {
  const [tab, setTab] = useState('overview');
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState('');

  const loadStatus = useCallback(() => {
    setLoadError('');
    return api
      .get('/api/status')
      .then(setStatus)
      .catch((e) => setLoadError(e.message || String(e)));
  }, [api]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  if (loadError) {
    return (
      <div className="card status-load-error">
        <p>Не удалось загрузить статус: {loadError}</p>
        <button type="button" className="secondary" onClick={() => loadStatus()}>
          Повторить
        </button>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="card">
        <p className="muted">Загрузка статуса…</p>
      </div>
    );
  }

  return (
    <div className="stack status-panel">
      <div className="status-toolbar">
        <div className="settings-tabs" role="tablist" aria-label="Разделы статуса">
          <TabButton id="overview" active={tab === 'overview'} onClick={setTab}>
            Сводка
          </TabButton>
          <TabButton id="triage" active={tab === 'triage'} onClick={setTab}>
            Логи разбора
          </TabButton>
        </div>
        <button type="button" className="secondary status-toolbar-refresh" onClick={() => loadStatus()}>
          Обновить статус
        </button>
      </div>

      {tab === 'overview' && <StatusOverview s={status} />}
      {tab === 'triage' && (
        <div className="stack">
          <TriageLogView api={api} embedded />
          <JournalIngestLogView api={api} embedded />
        </div>
      )}
    </div>
  );
}
