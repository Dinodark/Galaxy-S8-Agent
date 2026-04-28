import React, { useCallback, useEffect, useState } from 'react';

function fmtTs(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('ru-RU', {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  } catch {
    return String(ts);
  }
}

function flag(v) {
  if (v === true) return 'да';
  if (v === false) return 'нет';
  return '—';
}

export function TriageLogView({ api, embedded = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(80);

  const load = useCallback(() => {
    setError('');
    return api
      .get('/api/logs/inbox-triage?limit=' + encodeURIComponent(String(limit)))
      .then(setData)
      .catch((e) => setError(e.message || String(e)));
  }, [api, limit]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = (data && data.entries) || [];
  const path = data && data.path;

  const title = 'Журнал ночного разбора инбокса';

  return (
    <div className={'stack' + (embedded ? ' triage-log-embedded-wrap' : '')}>
      <section className={'card' + (embedded ? ' triage-log-embedded' : '')}>
        {embedded ? (
          <h3 className="triage-log-title-embedded">{title}</h3>
        ) : (
          <h2>{title}</h2>
        )}
        <p className={'muted triage-log-lead' + (embedded ? ' triage-log-lead-tight' : '')}>
          Одна строка JSON на каждый запуск triage после вечерней сводки (или ручного сценария). Файл на
          диске: <code>{path || 'memory/logs/inbox_triage.jsonl'}</code> — рядом с остальным состоянием
          агента в <code>memory/</code>.
        </p>

        <div className="triage-log-toolbar">
          <label className="triage-log-limit">
            Строк
            <input
              type="number"
              min={10}
              max={500}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) || 80)}
            />
          </label>
          <button type="button" className="secondary" onClick={() => load()}>
            Обновить
          </button>
        </div>

        {error && (
          <pre className="triage-log-error">{error}</pre>
        )}

        {rows.length === 0 && !error && (
          <p className="muted">Пока нет записей — после первого ночного разбора с непустым инбоксом здесь появятся строки.</p>
        )}

        {rows.length > 0 && (
          <div className="triage-table-wrap">
            <table className="triage-table">
              <thead>
                <tr>
                  <th>Время</th>
                  <th>День (inbox)</th>
                  <th>Пропуск</th>
                  <th>Очищен</th>
                  <th>write_note OK</th>
                  <th>Шагов инстр.</th>
                  <th>Снимок</th>
                  <th>Примечание</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice().reverse().map((row, i) => (
                  <tr key={row.ts + '-' + i}>
                    <td>{fmtTs(row.ts)}</td>
                    <td>{row.today || '—'}</td>
                    <td>{flag(row.skipped)}</td>
                    <td>{row.skipped ? '—' : flag(row.cleared)}</td>
                    <td>{row.writeNoteOk != null ? row.writeNoteOk : '—'}</td>
                    <td>{row.toolRows != null ? row.toolRows : '—'}</td>
                    <td className="triage-cell-mono">{row.archivedRel || '—'}</td>
                    <td className="triage-cell-note">
                      {row.parseError
                        ? 'битая строка в JSONL'
                        : String(row.error || row.reason || '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
