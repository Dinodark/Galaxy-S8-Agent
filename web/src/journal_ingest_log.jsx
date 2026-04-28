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

/** Лог ручной «Обработать день» из веб-журнала — тот же смысл, что triage: разложить сырой лог по заметкам. */
export function JournalIngestLogView({ api, embedded = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(80);

  const load = useCallback(() => {
    setError('');
    return api
      .get('/api/logs/journal-ingest?limit=' + encodeURIComponent(String(limit)))
      .then(setData)
      .catch((e) => setError(e.message || String(e)));
  }, [api, limit]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = (data && data.entries) || [];
  const path = data && data.path;

  const title = 'Журнал ручной обработки дня';

  return (
    <div className={'stack' + (embedded ? ' triage-log-embedded-wrap' : '')}>
      <section className={'card' + (embedded ? ' triage-log-embedded' : '')}>
        {embedded ? (
          <h3 className="triage-log-title-embedded">{title}</h3>
        ) : (
          <h2>{title}</h2>
        )}
        <p className={'muted triage-log-lead' + (embedded ? ' triage-log-lead-tight' : '')}>
          Строки по кнопке «Обработать день» на экране Journal. Файл:{' '}
          <code>{path || 'memory/logs/journal_ingest.jsonl'}</code>.
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

        {error && <pre className="triage-log-error">{error}</pre>}

        {rows.length === 0 && !error && (
          <p className="muted">
            Пока нет записей — после первого запуска «Обработать день» здесь появятся строки.
          </p>
        )}

        {rows.length > 0 && (
          <div className="triage-table-wrap">
            <table className="triage-table">
              <thead>
                <tr>
                  <th>Время</th>
                  <th>День</th>
                  <th>Пропуск</th>
                  <th>Причина</th>
                  <th>write_note OK</th>
                  <th>Шагов инстр.</th>
                  <th>Сообщ. в логе</th>
                  <th>Примечание</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice().reverse().map((row, i) => (
                  <tr key={(row.ts || '') + '-' + i}>
                    <td>{fmtTs(row.ts)}</td>
                    <td>{row.day || '—'}</td>
                    <td>{flag(row.skipped)}</td>
                    <td>{row.reason || '—'}</td>
                    <td>{row.writeNoteOk != null ? row.writeNoteOk : '—'}</td>
                    <td>{row.toolRows != null ? row.toolRows : '—'}</td>
                    <td>{row.entryCount != null ? row.entryCount : '—'}</td>
                    <td className="triage-cell-note">
                      {row.parseError ? 'битая строка в JSONL' : String(row.error || '')}
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
