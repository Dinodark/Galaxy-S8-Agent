import React, { useCallback, useEffect, useRef, useState } from 'react';

function formatBytes(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return '—';
  if (x < 1024) return `${Math.round(x)} B`;
  if (x < 1024 * 1024) return `${(x / 1024).toFixed(x < 10 * 1024 ? 1 : 0)} KB`;
  return `${(x / (1024 * 1024)).toFixed(x < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

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

function JsonBlock({ title, value }) {
  let text = '';
  try {
    text = value === undefined ? '' : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <details className="debug-llm-json-block">
      <summary className="debug-llm-json-summary">{title}</summary>
      <pre className="debug-llm-json-pre">{text || 'null'}</pre>
    </details>
  );
}

export function DebugLlmPanel({ api, debugLlm, focusId, onFocusConsumed, onSettingsChanged }) {
  const dl = debugLlm || {};
  const [mbDraft, setMbDraft] = useState(String(dl.maxMb ?? 20));
  const [filesDraft, setFilesDraft] = useState(String(dl.maxFiles ?? 80));
  const [listData, setListData] = useState(null);
  const [listErr, setListErr] = useState('');
  const [limit, setLimit] = useState(50);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailErr, setDetailErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [setErr, setSetErr] = useState('');
  const cardRefs = useRef({});

  const loadList = useCallback(() => {
    setListErr('');
    return api
      .get('/api/debug/llm/list?limit=' + encodeURIComponent(String(limit)))
      .then(setListData)
      .catch((e) => setListErr(e.message || String(e)));
  }, [api, limit]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    setMbDraft(String(dl.maxMb ?? 20));
    setFilesDraft(String(dl.maxFiles ?? 80));
  }, [dl.maxMb, dl.maxFiles]);

  const loadDetail = useCallback(
    (id) => {
      if (!id) {
        setDetail(null);
        return Promise.resolve();
      }
      setDetailErr('');
      return api
        .get('/api/debug/llm/entry?id=' + encodeURIComponent(id))
        .then(setDetail)
        .catch((e) => {
          setDetailErr(e.message || String(e));
          setDetail(null);
        });
    },
    [api]
  );

  useEffect(() => {
    if (!focusId) return;
    setOpenId(focusId);
    loadDetail(focusId).finally(() => {
      requestAnimationFrame(() => {
        const el = cardRefs.current[focusId];
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
      if (onFocusConsumed) onFocusConsumed();
    });
  }, [focusId, loadDetail, onFocusConsumed]);

  const postSetting = async (path, value) => {
    setSetErr('');
    setBusy(true);
    try {
      await api.post('/api/settings/set', { path, value });
      if (onSettingsChanged) await onSettingsChanged();
      await loadList();
    } catch (e) {
      setSetErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (!window.confirm('Удалить все сохранённые дампы LLM в папке отладки?')) return;
    setBusy(true);
    setSetErr('');
    try {
      await api.post('/api/debug/llm/clear', {});
      setOpenId(null);
      setDetail(null);
      await loadList();
    } catch (e) {
      setSetErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const entries = (listData && listData.entries) || [];
  const dir = listData && listData.dir;

  return (
    <div className="stack debug-llm-panel">
      <section className="card">
        <h2 className="debug-llm-title">Отладка LLM</h2>
        <p className="muted debug-llm-lead">
          Сохраняет запросы и ответы OpenRouter на диск в <code>{dir || 'logs/llm-debug'}</code> (как и
          обычные логи агента — только на вашей машине). Включайте на время диагностики.
        </p>

        <div className="debug-llm-controls">
          <label className="debug-llm-toggle">
            <input
              type="checkbox"
              checked={!!dl.enabled}
              disabled={busy}
              onChange={(e) => postSetting('debugLlm.enabled', e.target.checked)}
            />
            <span>Запись дампов включена</span>
          </label>
          <div className="debug-llm-limits">
            <label>
              Макс. МБ
              <input
                type="number"
                min={1}
                max={500}
                disabled={busy}
                value={mbDraft}
                onChange={(e) => setMbDraft(e.target.value)}
                onBlur={() => {
                  const n = parseInt(mbDraft, 10);
                  if (Number.isInteger(n) && n >= 1 && n <= 500) postSetting('debugLlm.maxMb', n);
                  else setMbDraft(String(dl.maxMb ?? 20));
                }}
              />
            </label>
            <label>
              Макс. файлов
              <input
                type="number"
                min={5}
                max={2000}
                disabled={busy}
                value={filesDraft}
                onChange={(e) => setFilesDraft(e.target.value)}
                onBlur={() => {
                  const n = parseInt(filesDraft, 10);
                  if (Number.isInteger(n) && n >= 5 && n <= 2000) {
                    postSetting('debugLlm.maxFiles', n);
                  } else setFilesDraft(String(dl.maxFiles ?? 80));
                }}
              />
            </label>
          </div>
          <button type="button" className="secondary" disabled={busy} onClick={() => loadList()}>
            Обновить список
          </button>
          <button type="button" className="danger" disabled={busy} onClick={() => clearAll()}>
            Удалить все
          </button>
        </div>

        {setErr && <pre className="debug-llm-error">{setErr}</pre>}
        {!dl.enabled && (
          <p className="muted debug-llm-hint">Пока запись выключена — новые дампы не появятся.</p>
        )}
      </section>

      <section className="card">
        <h3 className="debug-llm-subtitle">Записи</h3>
        <div className="triage-log-toolbar debug-llm-toolbar">
          <label className="triage-log-limit">
            Строк
            <input
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) || 50)}
            />
          </label>
        </div>
        {listErr && <pre className="debug-llm-error">{listErr}</pre>}
        {listData && (
          <p className="muted debug-llm-meta">
            Файлов: {listData.fileCount ?? entries.length} · суммарно {formatBytes(listData.totalBytes)}
          </p>
        )}
        {entries.length === 0 && !listErr && (
          <p className="muted">Пока нет файлов — после включения и нескольких вызовов модели список заполнится.</p>
        )}
        <ul className="debug-llm-list">
          {entries.map((row) => {
            const id = row.id;
            const expanded = openId === id;
            return (
              <li
                key={id}
                className={'debug-llm-card' + (expanded ? ' debug-llm-card-open' : '')}
                ref={(el) => {
                  if (el) cardRefs.current[id] = el;
                  else delete cardRefs.current[id];
                }}
              >
                <button
                  type="button"
                  className="debug-llm-card-head"
                  onClick={() => {
                    if (expanded) {
                      setOpenId(null);
                      setDetail(null);
                    } else {
                      setOpenId(id);
                      loadDetail(id);
                    }
                  }}
                >
                  <span className="debug-llm-chevron" aria-hidden>
                    {expanded ? '▼' : '▶'}
                  </span>
                  <span className="debug-llm-card-main">
                    <span className="debug-llm-card-ts">{fmtTs(row.ts)}</span>
                    <span className="muted debug-llm-card-scope">{row.scope || '—'}</span>
                    <span className="debug-llm-card-preview">{row.preview || '—'}</span>
                  </span>
                  <span className="debug-llm-card-size">{formatBytes(row.sizeBytes)}</span>
                </button>
                {expanded && (
                  <div className="debug-llm-card-body">
                    {detail && detail.id === id ? (
                      <>
                        <p className="muted debug-llm-mini">
                          <code>{id}</code>
                          {detail.model ? (
                            <>
                              {' · '}
                              <code>{detail.model}</code>
                            </>
                          ) : null}
                          {detail.triageBatchId ? (
                            <>
                              {' · batch '}
                              <code>{detail.triageBatchId}</code>
                            </>
                          ) : null}
                          {detail.turnId ? (
                            <>
                              {' · turn '}
                              <code>{detail.turnId}</code>
                            </>
                          ) : null}
                        </p>
                        {detail.error && (
                          <pre className="debug-llm-error-inline">{String(detail.error)}</pre>
                        )}
                        <JsonBlock title="Запрос (request)" value={detail.request} />
                        <JsonBlock title="Ответ (response)" value={detail.response} />
                      </>
                    ) : detailErr && openId === id ? (
                      <pre className="debug-llm-error">{detailErr}</pre>
                    ) : (
                      <p className="muted">Загрузка…</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
