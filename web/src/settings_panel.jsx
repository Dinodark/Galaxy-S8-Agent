import React, { useCallback, useEffect, useState } from 'react';
import { BatterySnapshotBlock } from './battery_snapshot.jsx';

function TabButton({ id, active, children, onClick }) {
  return (
    <button
      type="button"
      className={'settings-tab' + (active ? ' settings-tab-active' : '')}
      onClick={() => onClick(id)}
    >
      {children}
    </button>
  );
}

function ToggleRow({ label, hint, checked, disabled, onChange }) {
  return (
    <div className="settings-field">
      <label className="settings-toggle-label">
        <input
          type="checkbox"
          checked={!!checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      {hint && <p className="settings-hint">{hint}</p>}
    </div>
  );
}

function NumberRow({ label, hint, value, disabled, onSave, path }) {
  const [local, setLocal] = useState(String(value ?? ''));
  useEffect(() => {
    setLocal(String(value ?? ''));
  }, [value]);
  return (
    <div className="settings-field">
      <label className="settings-input-label">{label}</label>
      {hint && <p className="settings-hint">{hint}</p>}
      <div className="settings-inline">
        <input
          className="settings-input"
          type="number"
          value={local}
          disabled={disabled}
          onChange={(e) => setLocal(e.target.value)}
        />
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          onClick={() => onSave(path, Number(local))}
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}

function TextRow({ label, hint, value, disabled, onSave, placeholder, path }) {
  const [local, setLocal] = useState(String(value ?? ''));
  useEffect(() => {
    setLocal(String(value ?? ''));
  }, [value]);
  return (
    <div className="settings-field">
      <label className="settings-input-label">{label}</label>
      {hint && <p className="settings-hint">{hint}</p>}
      <div className="settings-inline settings-inline-grow">
        <input
          className="settings-input settings-input-wide"
          type="text"
          value={local}
          disabled={disabled}
          placeholder={placeholder || ''}
          onChange={(e) => setLocal(e.target.value)}
        />
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          onClick={() => onSave(path, local.trim())}
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}

export function SettingsPanel({ api }) {
  const [tab, setTab] = useState('easy');
  const [data, setData] = useState(null);
  const [agentStatus, setAgentStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoadError('');
    try {
      const s = await api.get('/api/settings');
      setData(s);
    } catch (err) {
      setLoadError(err.message || String(err));
      return;
    }
    try {
      const st = await api.get('/api/status');
      setAgentStatus(st);
    } catch {
      setAgentStatus(null);
    }
  }, [api]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function patch(path, value) {
    setSaveError('');
    setSaving(true);
    try {
      const res = await api.post('/api/settings/set', { path, value });
      if (res.settings) setData(res.settings);
      else await reload();
      api.get('/api/status').then(setAgentStatus).catch(() => setAgentStatus(null));
    } catch (e) {
      setSaveError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="card">
        <p>Не удалось загрузить настройки: {loadError}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card">
        <p className="muted">Загрузка…</p>
      </div>
    );
  }

  const dr = data.dailyReview || {};
  const st = data.stt || {};
  const kn = data.knowledge || {};
  const sn = data.silent || {};

  return (
    <div className="stack">
      {saveError && (
        <div className="card settings-banner-error">
          <strong>Ошибка сохранения</strong>
          <pre>{saveError}</pre>
        </div>
      )}
      {saving && <p className="muted settings-saving">Сохраняю…</p>}

      <div className="settings-tabs" role="tablist" aria-label="Разделы настроек">
        <TabButton id="easy" active={tab === 'easy'} onClick={setTab}>
          Удобно
        </TabButton>
        <TabButton id="schedule" active={tab === 'schedule'} onClick={setTab}>
          Расписание и ИИ
        </TabButton>
        <TabButton id="json" active={tab === 'json'} onClick={setTab}>
          Весь набор (JSON)
        </TabButton>
      </div>

      {tab === 'easy' && (
        <section className="card settings-card">
          <h2>Повседневные переключатели</h2>
          <p className="muted settings-lead">
            Здесь только то, что чаще всего нужно менять без знания cron и моделей.
          </p>

          <ToggleRow
            label="Вечерняя сводка в Telegram"
            hint="В заданное время бот читает журнал дня, пишет файл summary-ГГГГ-ММ-ДД.md и присылает его вам."
            checked={dr.enabled !== false}
            disabled={saving}
            onChange={(v) => patch('dailyReview.enabled', v)}
          />

          <ToggleRow
            label="Ночной разбор инбокса (triage)"
            hint="«Траж» — это triage: второй проход после сводки, модель раскладывает содержимое inbox.md по заметкам в memory/notes (не в сам инбокс). Снимок дня кладётся в inbox/archive/."
            checked={dr.inboxTriage !== false}
            disabled={saving}
            onChange={(v) => patch('dailyReview.inboxTriage', v)}
          />

          <ToggleRow
            label="Очищать инбокс только после успешных записей"
            hint="Если включено (рекомендуется), пустой шаблон в inbox.md ставится только когда модель хотя бы раз успешно вызвала write_note. Иначе инбокс остаётся как есть — ничего не «теряется молча»."
            checked={dr.clearInboxOnlyAfterWrites !== false}
            disabled={saving}
            onChange={(v) => patch('dailyReview.clearInboxOnlyAfterWrites', v)}
          />

          <ToggleRow
            label="Подсказки маршрута при сохранении в базу (orchestrator)"
            hint="Когда вы явно просите сохранить в память, агент получает короткую подсказку, куда логичнее дописать текст, опираясь на projects/_index.md и список файлов."
            checked={kn.orchestrator !== false}
            disabled={saving}
            onChange={(v) => patch('knowledge.orchestrator', v)}
          />

          <ToggleRow
            label="Голос в текст (STT)"
            hint="Нужен GROQ_API_KEY в окружении. Выключает распознавание голосовых в Telegram."
            checked={st.enabled !== false}
            disabled={saving}
            onChange={(v) => patch('stt.enabled', v)}
          />

          <ToggleRow
            label="После вечерней сводки выходить из silent"
            hint="Если вы в режиме «только пишу в журнал», после ночной сводки режим снова станет обычным чатом."
            checked={sn.autoExitOnDailyReview !== false}
            disabled={saving}
            onChange={(v) => patch('silent.autoExitOnDailyReview', v)}
          />

          <div className="settings-battery-card">
            <h3 className="settings-subtitle">Батарея телефона</h3>
            {!agentStatus ? (
              <p className="muted">Загрузка уровня заряда…</p>
            ) : (
              <BatterySnapshotBlock battery={agentStatus.battery} compact />
            )}
          </div>
        </section>
      )}

      {tab === 'schedule' && (
        <section className="card settings-card">
          <h2>Расписание и модели</h2>
          <p className="muted settings-lead">
            Cron — пять полей как в crontab (минута час день месяц день_недели), часовой пояс — IANA, например Europe/Moscow.
            Смена времени сводки вступит в силу после перезапуска бота (или горячего перезапуска планировщика), если не делаете это из Telegram /set.
          </p>

          <TextRow
            label="Cron вечерней сводки"
            hint="Пример: «30 22 * * *» — каждый день в 22:30 по выбранному часовому поясу."
            path="dailyReview.cron"
            value={dr.cron}
            disabled={saving}
            onSave={patch}
          />

          <TextRow
            label="Часовой пояс (IANA)"
            hint="Пусто — системный пояс сервера."
            path="dailyReview.tz"
            value={dr.tz || ''}
            disabled={saving}
            onSave={patch}
            placeholder="Europe/Moscow"
          />

          <NumberRow
            label="Минимум сообщений в журнале за день"
            hint="Если записей меньше — автосводка не запускается (чтобы не шуметь в пустые дни)."
            path="dailyReview.minMessages"
            value={dr.minMessages}
            disabled={saving}
            onSave={patch}
          />

          <NumberRow
            label="Сколько прошлых сводок подмешивать в контекст"
            path="dailyReview.prevDays"
            value={dr.prevDays}
            disabled={saving}
            onSave={patch}
          />

          <TextRow
            label="Модель для вечерней сводки"
            hint="Пусто — как у основного агента (OpenRouter). Можно указать отдельно, например anthropic/claude-haiku-4.5."
            path="dailyReview.model"
            value={dr.model || ''}
            disabled={saving}
            onSave={patch}
          />

          <NumberRow
            label="Макс. шагов цикла «тража» (инструменты)"
            hint="Сколько раз подряд модель может вызывать list/read/write_note за один ночной разбор инбокса."
            path="dailyReview.inboxTriageMaxSteps"
            value={dr.inboxTriageMaxSteps ?? 12}
            disabled={saving}
            onSave={patch}
          />

          <div className="settings-field">
            <p className="settings-hint">
              Отдельная модель только для разбора инбокса в коде пока не заведена — сейчас для тража
              используется то же поле «Модель для вечерней сводки» (или общая модель агента). Идея{' '}
              <code>triageModel</code> как раз в том, чтобы позже можно было выбрать дешёвую/строгую
              модель именно для инструментов, не трогая «литературную» сводку.
            </p>
          </div>
        </section>
      )}

      {tab === 'json' && (
        <section className="card">
          <h2>Полный объект настроек</h2>
          <p className="muted settings-lead">
            Для тонкой настройки и копирования. Токен веба здесь скрыт. Остальное — как в memory/settings.json.
          </p>
          <pre className="settings-json">{JSON.stringify(data, null, 2)}</pre>
        </section>
      )}
    </div>
  );
}
