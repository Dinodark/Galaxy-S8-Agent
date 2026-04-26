import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const navItems = [
  ['home', 'Home'],
  ['status', 'Status'],
  ['atlas', 'Memory Atlas'],
  ['notes', 'Notes'],
  ['summaries', 'Summaries'],
  ['journal', 'Journal'],
  ['settings', 'Settings'],
  ['update', 'Update'],
];

const PALETTE_STORAGE_KEY = 'galaxy-dashboard-palette-v2';
const PALETTE_PRESETS_KEY = 'galaxy-dashboard-palette-presets';

const basePalette = {
  '--color-bg': '#111111',
  '--color-surface': '#171717',
  '--color-surface-soft': '#1d1d1d',
  '--color-surface-hover': '#242424',
  '--color-text': '#f1f1f1',
  '--color-muted': '#9a9a9a',
  '--color-subtle': '#6f6f6f',
  '--color-accent': '#d6d6d6',
  '--color-glow': '#333333',
  '--color-user-mark': '#777777',
  '--color-agent-mark': '#555555',
  '--color-danger-bg': '#2a171a',
  '--color-danger-text': '#f0c8cf',
};

const paletteLabels = {
  '--color-bg': 'Фон',
  '--color-surface': 'Панель',
  '--color-surface-soft': 'Карточки',
  '--color-surface-hover': 'Hover',
  '--color-text': 'Текст',
  '--color-muted': 'Вторичный текст',
  '--color-subtle': 'Тонкий текст',
  '--color-accent': 'Акцент',
  '--color-glow': 'Свечение',
  '--color-user-mark': 'Метка пользователя',
  '--color-agent-mark': 'Метка агента',
  '--color-danger-bg': 'Danger фон',
  '--color-danger-text': 'Danger текст',
};

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function applyPalette(palette) {
  for (const [name, value] of Object.entries(palette)) {
    document.documentElement.style.setProperty(name, value);
  }
}

function tokenFromLocation() {
  return new URL(window.location.href).searchParams.get('token') || '';
}

function debugLog(hypothesisId, location, message, data) {
  fetch('http://127.0.0.1:7933/ingest/05d097ed-198e-47e6-8b77-1f7ddf4809a1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '047796',
    },
    body: JSON.stringify({
      sessionId: '047796',
      runId: 'atlas-pre-fix',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}

function useApi() {
  const token = useMemo(tokenFromLocation, []);
  return useMemo(() => {
    const withToken = (path) =>
      path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);

    return {
      token,
      get: async (path) => {
        const response = await fetch(withToken(path));
        if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
        return response.json();
      },
      post: async (path) => {
        const response = await fetch(withToken(path), { method: 'POST' });
        if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
        return response.json();
      },
    };
  }, [token]);
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return ts || '';
  }
}

function sourceLabel(source) {
  return source === 'assistant' ? 'white rabbit' : 'Ты';
}

function viaLabel(via) {
  return {
    voice: 'voice',
    audio: 'audio',
    video_note: 'video note',
    text: 'text',
  }[via || 'text'] || via || 'text';
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function atlasThemeQuery() {
  const theme = {
    bg: cssVar('--color-bg'),
    surface: cssVar('--color-surface'),
    surfaceSoft: cssVar('--color-surface-soft'),
    surfaceHover: cssVar('--color-surface-hover'),
    text: cssVar('--color-text'),
    muted: cssVar('--color-muted'),
    accent: cssVar('--color-accent'),
    line: cssVar('--line'),
  };
  return Object.entries(theme)
    .filter(([, value]) => value)
    .map(([key, value]) => 'theme_' + key + '=' + encodeURIComponent(value))
    .join('&');
}

function JsonCard({ data }) {
  return (
    <div className="card">
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

function ReaderModal({ title, meta, onClose, children, className = '' }) {
  return (
    <div className={'modal-backdrop ' + className} role="dialog" aria-modal="true">
      <section className="reader-modal">
        <header className="reader-top">
          <button className="back-button" onClick={onClose}>Назад</button>
          <div>
            <strong>{title}</strong>
            {meta && <span>{meta}</span>}
          </div>
        </header>
        <div className="reader-body">{children}</div>
      </section>
    </div>
  );
}

function ReaderPane({ title, meta, children }) {
  return (
    <section className="card reader-pane">
      <header className="reader-pane-top">
        <strong>{title}</strong>
        {meta && <span>{meta}</span>}
      </header>
      <div className="reader-pane-body">{children}</div>
    </section>
  );
}

function SummaryMarkdown({ text }) {
  const blocks = [];
  let list = [];

  function flushList() {
    if (list.length === 0) return;
    blocks.push({ type: 'list', items: list });
    list = [];
  }

  String(text || '').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }

    if (trimmed.startsWith('# ')) {
      flushList();
      blocks.push({ type: 'h1', text: trimmed.slice(2).trim() });
      return;
    }

    if (trimmed.startsWith('## ')) {
      flushList();
      blocks.push({ type: 'h2', text: trimmed.slice(3).trim() });
      return;
    }

    if (trimmed.startsWith('- ')) {
      list.push(trimmed.slice(2).trim());
      return;
    }

    flushList();
    blocks.push({ type: 'p', text: trimmed });
  });
  flushList();

  return (
    <div className="summary-markdown">
      {blocks.map((block, index) => {
        if (block.type === 'h1') return <h1 key={index}>{block.text}</h1>;
        if (block.type === 'h2') return <h2 key={index}>{block.text}</h2>;
        if (block.type === 'list') {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
            </ul>
          );
        }
        return <p key={index}>{block.text}</p>;
      })}
    </div>
  );
}

function excerpt(text, max = 220) {
  const clean = String(text || '')
    .replace(/[#>*_`[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

function extractSummaryInsights(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const thoughtsIndex = lines.findIndex((line) => /^##\s+Мои мысли/i.test(line));
  const tomorrowIndex = lines.findIndex((line) => /^##\s+На завтра/i.test(line));
  const start = thoughtsIndex >= 0 ? thoughtsIndex + 1 : 0;
  const end = tomorrowIndex > start ? tomorrowIndex : lines.length;
  return excerpt(lines.slice(start, end).join(' '), 260);
}

function FeedItem({ title, meta, children }) {
  return (
    <article className="feed-item">
      <div className="feed-meta">{meta}</div>
      <h3>{title}</h3>
      <div className="feed-body">{children}</div>
    </article>
  );
}

function Home({ api, setStateText, setView }) {
  const [state, setState] = useState({
    loading: true,
    status: null,
    notes: [],
    journal: [],
    latestSummary: null,
    summaryInsight: '',
    error: '',
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setStateText('refreshing...');
        const status = await api.get('/api/status');
        const notesData = await api.get('/api/notes');
        const journalData = await api.get('/api/journal?day=' + encodeURIComponent(status.journal.today));
        const summaries = notesData.notes
          .filter((note) => note.kind === 'summary')
          .sort((a, b) => String(b.name).localeCompare(String(a.name)));
        let latestSummary = summaries[0] || null;
        let summaryInsight = '';
        if (latestSummary) {
          const note = await api.get('/api/note?name=' + encodeURIComponent(latestSummary.name));
          summaryInsight = extractSummaryInsights(note.content);
        }

        if (!cancelled) {
          setState({
            loading: false,
            status,
            notes: notesData.notes,
            journal: journalData.entries || [],
            latestSummary,
            summaryInsight,
            error: '',
          });
          setStateText('');
        }
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false, error: err.message }));
          setStateText('');
        }
      }
    }

    load();
    return () => {
      cancelled = true;
      setStateText('');
    };
  }, [api, setStateText]);

  if (state.loading) return <div className="card muted">Loading dashboard feed...</div>;
  if (state.error) return <pre>{state.error}</pre>;

  const recentEntries = state.journal.slice(-5).reverse();
  const recentNotes = state.notes
    .filter((note) => note.kind === 'note')
    .sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)))
    .slice(0, 5);
  const summariesCount = state.notes.filter((note) => note.kind === 'summary').length;

  return (
    <div className="home">
      <section className="hero card">
        <div>
          <p className="eyebrow">Agent dashboard</p>
          <h2>Твоя рабочая карта мыслей, проектов и дневника</h2>
          <p className="muted">
            Здесь будет собираться состояние агента, новые записи, свежие сводки и структура проектов.
            Всё, что ты накидываешь в Telegram, постепенно превращается в карту.
          </p>
        </div>
        <div className="hero-actions">
          <button className="secondary" onClick={() => setView('journal')}>Открыть журнал</button>
          <button className="secondary" onClick={() => setView('atlas')}>Открыть mindmap</button>
        </div>
      </section>

      <section className="stats">
        <div className="stat-card">
          <span>Mode</span>
          <strong>{state.status.mode}</strong>
        </div>
        <div className="stat-card">
          <span>Today</span>
          <strong>{state.status.journal.entriesToday}</strong>
          <small>journal entries</small>
        </div>
        <div className="stat-card">
          <span>Notes</span>
          <strong>{recentNotes.length}</strong>
          <small>active files shown</small>
        </div>
        <div className="stat-card">
          <span>Summaries</span>
          <strong>{summariesCount}</strong>
          <small>daily reviews</small>
        </div>
      </section>

      <section className="home-grid">
        <div className="card">
          <div className="section-head">
            <h2>Feed</h2>
            <span className="muted">{state.status.journal.today}</span>
          </div>
          <div className="feed">
            {recentEntries.length === 0 && <p className="muted">Сегодня новых записей пока нет.</p>}
            {recentEntries.map((entry, index) => (
              <FeedItem
                key={index}
                title={sourceLabel(entry.source)}
                meta={fmtTime(entry.ts) + ' · ' + viaLabel(entry.via)}
              >
                {excerpt(entry.text, 260)}
              </FeedItem>
            ))}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="section-head">
              <h2>Latest insight</h2>
              <span className="muted">{state.latestSummary?.name || 'no summary yet'}</span>
            </div>
            <p>{state.summaryInsight || 'Инсайты появятся после первой вечерней сводки.'}</p>
          </div>

          <div className="card">
            <div className="section-head">
              <h2>Recent note files</h2>
              <button className="link-button" onClick={() => setView('notes')}>open all</button>
            </div>
            <div className="mini-list">
              {recentNotes.length === 0 && <p className="muted">Заметок пока нет.</p>}
              {recentNotes.map((note) => (
                <button className="mini-item" key={note.name} onClick={() => setView('notes')}>
                  <strong>{note.name}</strong>
                  <span>{note.mtime || ''}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>Agent state</h2>
            <p className="muted">
              STT: {state.status.stt.enabled ? 'on' : 'off'} · Daily review:{' '}
              {state.status.dailyReview.enabled ? 'on' : 'off'} · Reminders:{' '}
              {state.status.reminders.pending}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function FileBrowser({ kind, api, desktopDetail = false }) {
  const [notes, setNotes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [content, setContent] = useState('');

  useEffect(() => {
    api.get('/api/notes').then((data) => {
      setNotes(data.notes.filter((note) => note.kind === kind));
    });
  }, [api, kind]);

  async function openNote(name) {
    setSelected(name);
    const note = await api.get('/api/note?name=' + encodeURIComponent(name));
    setContent(note.content);
  }

  return (
    <div className={desktopDetail ? 'split-page' : ''}>
      <div className="card list-page">
        {notes.map((note) => (
          <button
            className={'item ' + (selected === note.name ? 'active' : '')}
            key={note.name}
            onClick={() => openNote(note.name)}
          >
            <strong>{note.name}</strong>
            <span className="muted">{note.mtime || ''}</span>
          </button>
        ))}
        {notes.length === 0 && <p className="muted">Файлов пока нет.</p>}
      </div>
      {desktopDetail && (
        <div className="desktop-reader">
          {selected ? (
            <ReaderPane title={selected} meta={kind}>
              {kind === 'summary' ? <SummaryMarkdown text={content} /> : <pre>{content}</pre>}
            </ReaderPane>
          ) : (
            <div className="card reader-empty">
              <p className="muted">Выбери сводку слева, чтобы открыть текст здесь.</p>
            </div>
          )}
        </div>
      )}
      {selected && (
        <ReaderModal
          className={desktopDetail ? 'mobile-reader' : ''}
          title={selected}
          meta={kind}
          onClose={() => setSelected(null)}
        >
          {kind === 'summary' ? <SummaryMarkdown text={content} /> : <pre>{content}</pre>}
        </ReaderModal>
      )}
    </div>
  );
}

function JournalEntries({ entries }) {
  if (entries.length === 0) return <p className="muted">No entries for this day.</p>;
  return (
    <div className="journal">
      {entries.map((entry, index) => (
        <article className={'entry ' + (entry.source || 'user')} key={index}>
          <div className="entry-meta">
            <span className="badge">{sourceLabel(entry.source)}</span>
            <span>{fmtTime(entry.ts)}</span>
            <span>{viaLabel(entry.via)}</span>
          </div>
          <div className="entry-text">{entry.text}</div>
        </article>
      ))}
    </div>
  );
}

function Journal({ api }) {
  const [days, setDays] = useState([]);
  const [selectedDay, setSelectedDay] = useState('');
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    api.get('/api/journal').then((data) => setDays(data.days));
  }, [api]);

  async function openDay(day) {
    const data = await api.get('/api/journal?day=' + encodeURIComponent(day));
    setSelectedDay(day);
    setEntries(data.entries);
  }

  return (
    <div className="split-page">
      <div className="card list-page">
        {days.map((day) => (
          <button
            className={'item ' + (selectedDay === day ? 'active' : '')}
            key={day}
            onClick={() => openDay(day)}
          >
            {day}
          </button>
        ))}
        {days.length === 0 && <p className="muted">Журнал пока пуст.</p>}
      </div>
      <div className="desktop-reader">
        {entries ? (
          <ReaderPane title={selectedDay} meta={entries.length + ' entries'}>
            <JournalEntries entries={entries} />
          </ReaderPane>
        ) : (
          <div className="card reader-empty">
            <p className="muted">Выбери день слева, чтобы открыть историю здесь.</p>
          </div>
        )}
      </div>
      {entries && (
        <ReaderModal
          className="mobile-reader"
          title={selectedDay}
          meta={entries.length + ' entries'}
          onClose={() => {
            setEntries(null);
            setSelectedDay('');
          }}
        >
          <JournalEntries entries={entries} />
        </ReaderModal>
      )}
    </div>
  );
}

function Atlas({ api, token, setStateText }) {
  const [ready, setReady] = useState(false);
  const [src, setSrc] = useState('');

  useEffect(() => {
    setStateText('building...');
    api.get('/api/atlas').then((atlas) => {
      // #region agent log
      debugLog('A1,A2,A3', 'web/src/main.jsx:Atlas:apiAtlas', 'atlas api result received', {
        stats: atlas.stats,
        noteCount: Array.isArray(atlas.notes) ? atlas.notes.length : null,
        graphNodeCount: atlas.graph && Array.isArray(atlas.graph.nodes) ? atlas.graph.nodes.length : null,
        graphLinkCount: atlas.graph && Array.isArray(atlas.graph.links) ? atlas.graph.links.length : null,
        folders: atlas.graph && Array.isArray(atlas.graph.folders) ? atlas.graph.folders : null,
        files: Array.isArray(atlas.notes) ? atlas.notes.map((note) => note.file).slice(0, 50) : null,
      });
      // #endregion
      setStateText(atlas.stats.notes + ' files, ' + atlas.stats.folders + ' folders');
      const theme = atlasThemeQuery();
      setSrc(
        '/atlas.html?token=' +
        encodeURIComponent(token) +
        '&atlas_ts=' +
        encodeURIComponent(atlas.generatedAt || Date.now()) +
        (theme ? '&' + theme : '')
      );
      setReady(true);
    });
    return () => setStateText('');
  }, [api, setStateText]);

  if (!ready) return <div className="card muted">Building atlas...</div>;
  return <iframe src={src} title="Memory Atlas" />;
}

function UpdatePanel({ api }) {
  const [log, setLog] = useState(null);

  async function refreshLog() {
    setLog(await api.get('/api/actions/update-log'));
  }

  async function triggerUpdate() {
    if (!window.confirm('Update code and restart bot + web UI? The page may disconnect for a few seconds.')) {
      return;
    }
    const result = await api.post('/api/actions/update-restart');
    setLog({
      running: true,
      content: JSON.stringify(result, null, 2) + '\n\nRefresh this log in a few seconds.',
    });
  }

  useEffect(() => {
    refreshLog();
  }, []);

  return (
    <div className="stack">
      <div className="card">
        <h2>Update & restart agent</h2>
        <p className="muted">
          Runs git pull, npm install, doctor, then restarts bot and web tmux sessions.
          The page may disconnect for a few seconds.
        </p>
        <div className="actions">
          <button className="danger" onClick={triggerUpdate}>Update & restart</button>
          <button className="secondary" onClick={refreshLog}>Refresh log</button>
        </div>
      </div>
      <div className="card">
        <pre>{(log?.running ? '[running]\n' : '') + (log?.content || 'No update log yet.')}</pre>
      </div>
    </div>
  );
}

function MoodPalette() {
  const [palette, setPalette] = useState(() => ({
    ...basePalette,
    ...readJsonStorage(PALETTE_STORAGE_KEY, {}),
  }));
  const [presets, setPresets] = useState(() => readJsonStorage(PALETTE_PRESETS_KEY, []));
  const [presetName, setPresetName] = useState('');

  useEffect(() => {
    applyPalette(palette);
  }, [palette]);

  function updateColor(name, value) {
    setPalette((current) => ({ ...current, [name]: value }));
  }

  function saveCurrent() {
    localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(palette));
  }

  function resetBase() {
    setPalette(basePalette);
    localStorage.removeItem(PALETTE_STORAGE_KEY);
  }

  function savePreset() {
    const name = presetName.trim() || `Preset ${presets.length + 1}`;
    const next = [
      ...presets.filter((preset) => preset.name !== name),
      { name, palette },
    ];
    setPresets(next);
    localStorage.setItem(PALETTE_PRESETS_KEY, JSON.stringify(next));
    setPresetName('');
  }

  function loadPreset(preset) {
    setPalette({ ...basePalette, ...preset.palette });
  }

  function deletePreset(name) {
    const next = presets.filter((preset) => preset.name !== name);
    setPresets(next);
    localStorage.setItem(PALETTE_PRESETS_KEY, JSON.stringify(next));
  }

  return (
    <details className="mood">
      <summary>Настроение</summary>
      <div className="mood-panel">
        <div className="palette-grid">
          {Object.entries(palette).map(([name, value]) => (
            <label className="color-field" key={name}>
              <span>{paletteLabels[name] || name}</span>
              <input
                type="color"
                value={value}
                onChange={(event) => updateColor(name, event.target.value)}
              />
              <code>{value}</code>
            </label>
          ))}
        </div>

        <div className="mood-actions">
          <button className="secondary" onClick={saveCurrent}>Сохранить текущую</button>
          <button className="secondary" onClick={resetBase}>Базовая</button>
        </div>

        <div className="preset-form">
          <input
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            placeholder="Название пресета"
          />
          <button className="secondary" onClick={savePreset}>Сохранить пресет</button>
        </div>

        <div className="presets">
          {presets.length === 0 && <p className="muted">Пресетов пока нет.</p>}
          {presets.map((preset) => (
            <div className="preset-row" key={preset.name}>
              <button onClick={() => loadPreset(preset)}>{preset.name}</button>
              <button onClick={() => deletePreset(preset.name)}>×</button>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function App() {
  const api = useApi();
  const [view, setView] = useState('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [stateText, setStateText] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    setData(null);
    setStateText('');
    if (view === 'status') {
      api.get('/api/status').then(setData).catch((err) => setError(err.message));
    }
    if (view === 'settings') {
      api.get('/api/settings').then(setData).catch((err) => setError(err.message));
    }
  }, [api, view]);

  const title = navItems.find(([id]) => id === view)?.[1] || 'Dashboard';

  function navigate(id) {
    setView(id);
    setMenuOpen(false);
  }

  return (
    <div id="app">
      <aside className={'side ' + (menuOpen ? 'open' : '')}>
        <h1>Vatoko Galaxy</h1>
        <div className="nav">
          {navItems.map(([id, label]) => (
            <button
              className={view === id ? 'active' : ''}
              key={id}
              onClick={() => navigate(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="muted">Dashboard for notes, projects, journal, and agent state.</p>
        <MoodPalette />
      </aside>
      {menuOpen && <button className="drawer-backdrop" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}
      <main className="main">
        <div className="top">
          <div className="top-title">
            <button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Open menu">☰</button>
            <strong>{title}</strong>
          </div>
          <span className="muted">{stateText}</span>
        </div>
        <div className="content">
          {error && <pre>{error}</pre>}
          {view === 'home' && <Home api={api} setStateText={setStateText} setView={setView} />}
          {!error && view === 'status' && data && <JsonCard data={data} />}
          {!error && view === 'settings' && data && <JsonCard data={data} />}
          {view === 'atlas' && <Atlas api={api} token={api.token} setStateText={setStateText} />}
          {view === 'notes' && <FileBrowser api={api} kind="note" />}
          {view === 'summaries' && <FileBrowser api={api} kind="summary" desktopDetail />}
          {view === 'journal' && <Journal api={api} />}
          {view === 'update' && <UpdatePanel api={api} />}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
