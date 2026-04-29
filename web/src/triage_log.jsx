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

function formatToolCounts(tc) {
  if (!tc || typeof tc !== 'object') return '';
  const parts = [];
  if (tc.list_notes) parts.push(`list×${tc.list_notes}`);
  if (tc.read_note) parts.push(`read×${tc.read_note}`);
  if (tc.write_note) parts.push(`write×${tc.write_note}`);
  return parts.join(' ');
}

/** Одна строка из triageSteps для чтения человеком. */
function formatTriageStepLine(s) {
  if (!s || typeof s !== 'object') return String(s);
  if (s.tool === 'list_notes') {
    const n = s.fileCount != null ? ` — ${s.fileCount} файлов` : '';
    return `${s.step}. list_notes ${s.ok ? 'OK' : 'ошибка'}${n}`;
  }
  if (s.tool === 'read_note') {
    const found = s.found ? 'найден' : 'нет';
    return `${s.step}. read_note \`${s.name || '—'}\` (${found})`;
  }
  if (s.tool === 'write_note') {
    const mode = s.append === false ? 'replace' : 'append';
    const chars =
      typeof s.contentChars === 'number' ? `${s.contentChars} симв.` : '';
    const dest = s.saved ? ` → \`${s.saved}\`` : '';
    const err = s.error ? ` — ${s.error}` : '';
    return `${s.step}. write_note ${s.ok ? 'OK' : 'FAIL'} \`${s.name || '?'}\` (${mode}, ${chars})${dest}${err}`;
  }
  return `${s.step}. ${s.tool}`;
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
          После каждого разбора сохраняется запись с подсчётом вызовов, проверкой файлов на диске и
          пошаговым списком инструментов (<code>triageSteps</code>). Файл:{' '}
          <code>{path || 'memory/logs/inbox_triage.jsonl'}</code> в <code>memory/</code>.
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
                  <th>День</th>
                  <th>Пропуск</th>
                  <th>Очищен</th>
                  <th title="Успешных write_note по ответу инструмента">write OK</th>
                  <th title="Файлов подтверждено на диске после записи">на диске</th>
                  <th title="list_notes / read_note / write_note — число вызовов">инстр.</th>
                  <th>Снимок</th>
                  <th>Детали</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice().reverse().map((row, i) => {
                  const steps = Array.isArray(row.triageSteps)
                    ? row.triageSteps
                    : [];
                  const tc = formatToolCounts(row.toolCounts);
                  const noteParts = [];
                  if (row.parseError) noteParts.push('битая строка в JSONL');
                  else {
                    if (row.error) noteParts.push(String(row.error));
                    if (row.reason) noteParts.push(String(row.reason));
                    if (row.verificationMismatch) {
                      noteParts.push(
                        'расхождение: инструмент vs диск (см. шаги и missing)'
                      );
                    }
                    if (
                      Array.isArray(row.writtenNotesMissing) &&
                      row.writtenNotesMissing.length > 0
                    ) {
                      noteParts.push(
                        `не найдены: ${row.writtenNotesMissing.join(', ')}`
                      );
                    }
                  }
                  const mismatch =
                    row.writeNoteOk != null &&
                    row.writeNoteVerified != null &&
                    row.writeNoteOk !== row.writeNoteVerified;
                  return (
                    <tr key={row.ts + '-' + i}>
                      <td>{fmtTs(row.ts)}</td>
                      <td>{row.today || '—'}</td>
                      <td>{flag(row.skipped)}</td>
                      <td>{row.skipped ? '—' : flag(row.cleared)}</td>
                      <td>{row.writeNoteOk != null ? row.writeNoteOk : '—'}</td>
                      <td
                        className={
                          mismatch ? 'triage-cell-warn' : ''
                        }
                        title={
                          mismatch
                            ? 'Не совпадает с колонкой write OK — смотри шаги write_note'
                            : ''
                        }
                      >
                        {row.writeNoteVerified != null
                          ? row.writeNoteVerified
                          : '—'}
                      </td>
                      <td className="triage-cell-mono triage-cell-compact">
                        {tc || (row.toolRows != null ? `${row.toolRows} выз.` : '—')}
                      </td>
                      <td className="triage-cell-mono">{row.archivedRel || '—'}</td>
                      <td className="triage-cell-detail">
                        {noteParts.length > 0 && (
                          <p className="triage-note-line muted">{noteParts.join(' · ')}</p>
                        )}
                        {steps.length > 0 ? (
                          <details className="triage-steps-details">
                            <summary>
                              Пошагово ({steps.length})
                            </summary>
                            <ol className="triage-steps-list">
                              {steps.map((s, si) => (
                                <li key={si}>
                                  <code className="triage-step-code">
                                    {formatTriageStepLine(s)}
                                  </code>
                                </li>
                              ))}
                            </ol>
                          </details>
                        ) : (
                          !row.skipped &&
                          !row.parseError && (
                            <span className="muted triage-no-steps">
                              нет triageSteps (старая запись)
                            </span>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
