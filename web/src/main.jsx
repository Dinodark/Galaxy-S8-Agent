import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { SettingsPanel } from './settings_panel.jsx';
import { AgentFlowDiagram } from './agent_flow.jsx';
import { StatusPanel } from './status_panel.jsx';
import { formatBalanceMain, formatBalanceSubtitle, formatUsd } from './openrouter_money.js';
import { useDesignSystem } from './design_system.js';

const navItems = [
  ['home', 'Home'],
  ['flow', 'Схема'],
  ['atlas', 'Memory Atlas'],
  ['summaries', 'Summaries'],
  ['notes', 'Notes'],
  ['journal', 'Journal'],
  ['reminders', 'Reminders'],
  ['settings', 'Settings'],
  ['status', 'Status'],
  ['update', 'Update'],
];

function tokenFromLocation() {
  return new URL(window.location.href).searchParams.get('token') || '';
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
      post: async (path, body) => {
        const opts = { method: 'POST' };
        if (body !== undefined) {
          opts.headers = { 'Content-Type': 'application/json' };
          opts.body = JSON.stringify(body);
        }
        const response = await fetch(withToken(path), opts);
        let data = {};
        try {
          data = await response.json();
        } catch {
          /* body may be empty or non-JSON */
        }
        if (!response.ok) {
          const msg =
            data && typeof data.error === 'string'
              ? data.error
              : response.status + ' ' + response.statusText;
          throw new Error(msg);
        }
        return data;
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

/** getDay(): 0=Вс … 6=Сб — для заголовка модалки напоминаний */
const WEEKDAYS_SHORT_RU = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];

function formatReminderDayModalLabel(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const wd = WEEKDAYS_SHORT_RU[d.getDay()];
  const rest = d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `${wd}, ${rest}`;
}

function parseSummaryDate(name) {
  const m = String(name || '').match(/summary-(\d{4})-(\d{2})-(\d{2})\.md$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatSummaryMenuLabel(name) {
  const d = parseSummaryDate(name);
  if (!d) return name;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function formatSummaryTitleLabel(name) {
  const d = parseSummaryDate(name);
  if (!d) return name;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatSummaryMetaLabel(name, mtime) {
  const d = parseSummaryDate(name);
  if (d) {
    return d.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
  return fmtTime(mtime);
}

function parseIsoDay(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatJournalDayLabel(value) {
  const d = parseIsoDay(value);
  if (!d) return value;
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Дата для confirm() повторной обработки журнала. */
function formatJournalIngestHumanDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso || '';
  }
}

/** Разбор вызовов разбора дня (list/read/write) для подписи в баннере. */
function formatJournalIngestToolCounts(tc) {
  if (!tc || typeof tc !== 'object') return '';
  const parts = [];
  if (tc.list_notes) parts.push(`list_notes×${tc.list_notes}`);
  if (tc.read_note) parts.push(`read_note×${tc.read_note}`);
  if (tc.write_note) parts.push(`write_note×${tc.write_note}`);
  return parts.join(', ');
}

/** Суммарный usage из нескольких вызовов chat (ingest / агент). */
function formatAggUsage(u) {
  if (!u || typeof u !== 'object') return '';
  const pt = Number(u.prompt_tokens) || 0;
  const ct = Number(u.completion_tokens) || 0;
  const tt = Number(u.total_tokens) || pt + ct || 0;
  const parts = [`вход ${pt} · выход ${ct} · всего ${tt}`];
  if (Number(u.cost) > 0) parts.push(`≈ $${Number(u.cost).toFixed(5)}`);
  return parts.join(' · ');
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

function ReaderModal({ title, meta, onClose, children, className = '', actions }) {
  return (
    <div className={'modal-backdrop ' + className} role="dialog" aria-modal="true">
      <section className="reader-modal">
        <header className="reader-top">
          <button className="back-button" onClick={onClose}>Назад</button>
          <div className="reader-top-titles">
            <strong>{title}</strong>
            {meta && <span>{meta}</span>}
          </div>
        </header>
        {actions && <div className="reader-modal-actions">{actions}</div>}
        <div className="reader-body">{children}</div>
      </section>
    </div>
  );
}

function ReaderPane({ title, meta, children, actions }) {
  return (
    <section className="card reader-pane">
      <header className={'reader-pane-top' + (actions ? ' reader-pane-top-has-actions' : '')}>
        <div className="reader-pane-head-text">
          <strong>{title}</strong>
          {meta && <span>{meta}</span>}
        </div>
        {actions}
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

/** Текст секции «Мои мысли» … до «На завтра» в сводке (файл memory/notes/summary-*.md). */
function extractInsightsSection(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const thoughtsIndex = lines.findIndex((line) => /^##\s+Мои мысли/i.test(line));
  const tomorrowIndex = lines.findIndex((line) => /^##\s+На завтра/i.test(line));
  const start = thoughtsIndex >= 0 ? thoughtsIndex + 1 : 0;
  const end = tomorrowIndex > start ? tomorrowIndex : lines.length;
  return lines.slice(start, end).join('\n').trim();
}

function extractSummaryInsights(text) {
  const body = extractInsightsSection(text);
  if (!body) return '';
  const singleLine = body.replace(/\s+/g, ' ');
  return excerpt(singleLine, 260);
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
    summariesList: [],
    error: '',
  });
  const [summaryIdx, setSummaryIdx] = useState(0);
  const [summaryContent, setSummaryContent] = useState('');
  const [insightExpanded, setInsightExpanded] = useState(false);

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

        if (!cancelled) {
          setState({
            loading: false,
            status,
            notes: notesData.notes,
            journal: journalData.entries || [],
            summariesList: summaries,
            error: '',
          });
          setSummaryIdx(0);
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

  useEffect(() => {
    setInsightExpanded(false);
  }, [summaryIdx]);

  useEffect(() => {
    const list = state.summariesList;
    if (!list.length || summaryIdx < 0 || summaryIdx >= list.length) {
      setSummaryContent('');
      return;
    }
    let cancelled = false;
    const name = list[summaryIdx].name;
    api
      .get('/api/note?name=' + encodeURIComponent(name))
      .then((note) => {
        if (!cancelled) setSummaryContent(note.content || '');
      })
      .catch(() => {
        if (!cancelled) setSummaryContent('');
      });
    return () => {
      cancelled = true;
    };
  }, [api, state.summariesList, summaryIdx]);

  function stepSummary(delta) {
    setSummaryIdx((i) => {
      const n = state.summariesList.length;
      if (n === 0) return 0;
      return Math.min(Math.max(0, i + delta), n - 1);
    });
  }

  if (state.loading) return <div className="card muted">Loading dashboard feed...</div>;
  if (state.error) return <pre>{state.error}</pre>;

  const recentEntries = state.journal.slice(-5).reverse();
  const recentNotes = state.notes
    .filter((note) => note.kind === 'note')
    .sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)))
    .slice(0, 5);
  const summariesCount = state.notes.filter((note) => note.kind === 'summary').length;
  const summariesList = state.summariesList;
  const currentSummaryName = summariesList[summaryIdx]?.name || '';
  const insightFullText = extractInsightsSection(summaryContent);
  const insightPreviewText = extractSummaryInsights(summaryContent);
  const insightCollapsedShown =
    insightPreviewText ||
    (insightFullText ? excerpt(insightFullText.replace(/\s+/g, ' '), 260) : '');
  const insightEmpty =
    summariesList.length > 0 && !insightFullText && !insightPreviewText;

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
        <div className="stat-card">
          <span>Остаток OpenRouter</span>
          <strong title="limit_remaining, USD (GET /api/v1/key)">
            {formatBalanceMain(state.status.openrouter)}
          </strong>
          <small>
            {state.status.openrouter?.ok
              ? formatBalanceSubtitle(state.status.openrouter) ||
                (state.status.openrouter.currency === 'USD'
                  ? 'суммы в USD с панели ключа'
                  : 'лимит / расход')
              : state.status.openrouter?.error || 'данные ключа недоступны'}
          </small>
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
          <div
            className={'card insight-card' + (insightExpanded ? ' insight-card-expanded' : '')}
            onClick={() => {
              if (summariesList.length) setInsightExpanded((v) => !v);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (!summariesList.length) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setInsightExpanded((v) => !v);
              }
            }}
            aria-expanded={insightExpanded}
          >
            <div className="section-head insight-head">
              <div className="insight-title-block">
                <h2>Latest insight</h2>
                <span className="muted insight-date-label">
                  {currentSummaryName
                    ? formatSummaryTitleLabel(currentSummaryName)
                    : 'нет сводок'}
                </span>
              </div>
              <div className="insight-nav">
                <button
                  type="button"
                  className="insight-arrow"
                  aria-label="Новее"
                  disabled={summaryIdx <= 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    stepSummary(-1);
                  }}
                >
                  ‹
                </button>
                <span className="muted insight-counter">
                  {summariesList.length ? `${summaryIdx + 1} / ${summariesList.length}` : '—'}
                </span>
                <button
                  type="button"
                  className="insight-arrow"
                  aria-label="Старее"
                  disabled={summaryIdx >= summariesList.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    stepSummary(1);
                  }}
                >
                  ›
                </button>
              </div>
            </div>
            <p
              className={
                'insight-body-text' + (insightExpanded ? ' insight-body-text-full' : '')
              }
            >
              {summariesList.length === 0 && 'Инсайты появятся после первой вечерней сводки.'}
              {summariesList.length > 0 && insightEmpty && (
                <>В этой сводке нет блока «Мои мысли» или он пуст.</>
              )}
              {summariesList.length > 0 &&
                !insightEmpty &&
                (insightExpanded ? insightFullText || insightCollapsedShown : insightCollapsedShown)}
            </p>
            {summariesList.length > 0 && currentSummaryName && (
              <p
                className="muted insight-source"
                onClick={(e) => e.stopPropagation()}
              >
                Фрагмент из <code>memory/notes/{currentSummaryName}</code>, секция «Мои мысли» (до «На завтра»).
                {insightExpanded ? ' Клик по карточке — свернуть.' : ' Клик по карточке — развернуть целиком.'}
              </p>
            )}
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
                  <span>{fmtTime(note.mtime)}</span>
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
              {state.status.openrouter?.ok && (
                <>
                  {' '}
                  · баланс {formatBalanceMain(state.status.openrouter)}
                  {formatUsd(state.status.openrouter.usage_daily) && (
                    <> · сегодня {formatUsd(state.status.openrouter.usage_daily)}</>
                  )}
                </>
              )}
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
  const kindLabel = kind === 'summary' ? 'сводку' : 'файл';
  const selectedStorageKey = 'galaxy-dashboard-selected-' + kind;
  const selectedDisplayTitle =
    kind === 'summary' ? formatSummaryTitleLabel(selected) : selected;

  useEffect(() => {
    api.get('/api/notes').then((data) => {
      setNotes(data.notes.filter((note) => note.kind === kind));
    });
  }, [api, kind]);

  useEffect(() => {
    if (!notes.length) return;
    const saved = localStorage.getItem(selectedStorageKey) || '';
    if (!saved) return;
    if (!notes.some((note) => note.name === saved)) return;
    openNote(saved);
  }, [notes]);

  async function openNote(name) {
    setSelected(name);
    localStorage.setItem(selectedStorageKey, name);
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
            <strong>
              {kind === 'summary' ? formatSummaryMenuLabel(note.name) : note.name}
            </strong>
            <span className="muted">
              {kind === 'summary'
                ? formatSummaryMetaLabel(note.name, note.mtime)
                : fmtTime(note.mtime)}
            </span>
          </button>
        ))}
        {notes.length === 0 && <p className="muted">Файлов пока нет.</p>}
      </div>
      {desktopDetail && (
        <div className="desktop-reader">
          {selected ? (
            <ReaderPane title={selectedDisplayTitle} meta={kind}>
              {kind === 'summary' ? <SummaryMarkdown text={content} /> : <pre>{content}</pre>}
            </ReaderPane>
          ) : (
            <div className="card reader-empty">
              <p className="muted">Выбери {kindLabel} слева, чтобы открыть текст здесь.</p>
            </div>
          )}
        </div>
      )}
      {selected && (
        <ReaderModal
          className={desktopDetail ? 'mobile-reader' : ''}
          title={selectedDisplayTitle}
          meta={kind}
          onClose={() => setSelected(null)}
        >
          {kind === 'summary' ? <SummaryMarkdown text={content} /> : <pre>{content}</pre>}
        </ReaderModal>
      )}
    </div>
  );
}

function JournalEntries({ entries, onToggleExclude, excludedBusyId }) {
  if (entries.length === 0) return <p className="muted">No entries for this day.</p>;
  return (
    <div className="journal">
      {entries.map((entry, index) => {
        const busy = excludedBusyId === entry.id;
        const excludeLabel = entry.excluded ? 'Вернуть в обработку' : 'Исключить из обработки';
        return (
        <article
          className={
            'entry ' +
            (entry.source || 'user') +
            (entry.excluded ? ' entry-excluded' : '')
          }
          key={entry.id || index}
        >
          {onToggleExclude && (
            <button
              type="button"
              className={
                'entry-exclude-btn' +
                (entry.excluded ? ' entry-exclude-btn-restore' : '')
              }
              title={excludeLabel}
              aria-label={excludeLabel}
              disabled={busy}
              onClick={() => onToggleExclude(entry)}
            >
              {entry.excluded ? (
                <span className="entry-exclude-restore-glyph" aria-hidden>
                  ↺
                </span>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="1.6"
                    fill="none"
                    d="M4 4l8 8M12 4L4 12"
                  />
                </svg>
              )}
            </button>
          )}
          <div className="entry-meta">
            <span className="badge">{sourceLabel(entry.source)}</span>
            <span>{fmtTime(entry.ts)}</span>
            <span>{viaLabel(entry.via)}</span>
          </div>
          <div className="entry-text">{entry.text}</div>
        </article>
        );
      })}
    </div>
  );
}

function Journal({ api }) {
  const [days, setDays] = useState([]);
  const [selectedDay, setSelectedDay] = useState('');
  const [entries, setEntries] = useState(null);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestMsg, setIngestMsg] = useState('');
  const [ingestErr, setIngestErr] = useState('');
  const [ingestDetail, setIngestDetail] = useState(null);
  const [lastJournalIngest, setLastJournalIngest] = useState(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [excludeBusyId, setExcludeBusyId] = useState('');
  const selectedDayStorageKey = 'galaxy-dashboard-selected-journal-day';

  useEffect(() => {
    api.get('/api/journal').then((data) => setDays(data.days));
  }, [api]);

  useEffect(() => {
    if (!days.length) return;
    const saved = localStorage.getItem(selectedDayStorageKey) || '';
    if (!saved || !days.includes(saved)) return;
    openDay(saved);
  }, [days]);

  async function openDay(day) {
    const data = await api.get(
      '/api/journal?day=' +
        encodeURIComponent(day) +
        (showExcluded ? '&includeExcluded=1' : '')
    );
    setSelectedDay(day);
    localStorage.setItem(selectedDayStorageKey, day);
    setEntries(data.entries);
    setLastJournalIngest(data.lastJournalIngest || null);
    setIngestMsg('');
    setIngestErr('');
    setIngestDetail(null);
  }

  async function toggleExclude(entry) {
    if (!selectedDay || !entry || !entry.id) return;
    setExcludeBusyId(entry.id);
    try {
      await api.post('/api/journal/exclude', {
        day: selectedDay,
        entryId: entry.id,
        excluded: !entry.excluded,
      });
      await openDay(selectedDay);
    } catch (e) {
      setIngestErr(e.message || String(e));
    } finally {
      setExcludeBusyId('');
    }
  }

  async function runDayIngest() {
    if (!selectedDay || ingestBusy) return;
    if (lastJournalIngest && lastJournalIngest.ts) {
      const when = formatJournalIngestHumanDate(lastJournalIngest.ts);
      const ok = window.confirm(
        `Журнал был обработан ${when}. Уверены, что хотите обработать его ещё раз?`
      );
      if (!ok) return;
    }
    setIngestBusy(true);
    setIngestMsg('');
    setIngestErr('');
    setIngestDetail(null);
    try {
      const r = await api.post('/api/journal/ingest', { day: selectedDay });
      if (r.skipped && r.reason === 'empty_day') {
        setIngestMsg('День пуст — нечего разносить по заметкам.');
      } else {
        const toolOk = r.writeNoteOk != null ? r.writeNoteOk : 0;
        const verified =
          r.writeNoteVerified != null ? r.writeNoteVerified : toolOk;
        const t = r.toolRows != null ? r.toolRows : 0;
        const tc = formatJournalIngestToolCounts(r.toolCounts);
        let msg = `Готово: подтверждено на диске — ${verified} записей`;
        if (r.verificationMismatch && toolOk !== verified) {
          msg += ` (инструмент сообщил об успехе ${toolOk} раз — проверьте каталог заметок или лог)`;
        }
        msg += `; вызовов инструментов — ${t}`;
        if (tc) msg += ` (${tc})`;
        msg += '.';
        if (
          verified === 0 &&
          toolOk === 0 &&
          r.toolCounts &&
          r.toolCounts.list_notes > 0 &&
          (!r.toolCounts.write_note || r.toolCounts.write_note === 0)
        ) {
          msg +=
            ' Был только просмотр списка заметок — новых записей не делали (часто так при повторной обработке, если всё уже разнесено).';
        }
        setIngestMsg(msg);
        const usageLine = formatAggUsage(r.usage);
        const missingNote =
          r.verificationMismatch && Array.isArray(r.writtenNotesMissing) && r.writtenNotesMissing.length > 0
            ? `Не найдены после записи: ${r.writtenNotesMissing.join(', ')}`
            : '';
        setIngestDetail({
          writtenNotes: Array.isArray(r.writtenNotes) ? r.writtenNotes : [],
          usageLine: usageLine || '',
          verificationWarning: missingNote,
        });
      }
    } catch (e) {
      setIngestErr(e.message || String(e));
    } finally {
      setIngestBusy(false);
      try {
        const refreshed = await api.get('/api/journal?day=' + encodeURIComponent(selectedDay));
        setLastJournalIngest(refreshed.lastJournalIngest || null);
      } catch {
        /* ignore */
      }
    }
  }

  const ingestActions =
    entries && selectedDay ? (
      <div className="journal-ingest-toolbar">
        <button
          type="button"
          className="secondary"
          disabled={ingestBusy}
          onClick={runDayIngest}
        >
          {ingestBusy ? 'Обработка…' : lastJournalIngest ? 'Обработать снова' : 'Обработать день'}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!selectedDay || ingestBusy}
          onClick={async () => {
            const next = !showExcluded;
            setShowExcluded(next);
            if (selectedDay) {
              const data = await api.get(
                '/api/journal?day=' +
                  encodeURIComponent(selectedDay) +
                  (next ? '&includeExcluded=1' : '')
              );
              setEntries(data.entries);
              setLastJournalIngest(data.lastJournalIngest || null);
            }
          }}
        >
          {showExcluded ? 'Скрыть исключённые' : 'Показать исключённые'}
        </button>
      </div>
    ) : null;

  const showIngestBanner =
    ingestErr ||
    ingestMsg ||
    (ingestDetail &&
      ((ingestDetail.writtenNotes && ingestDetail.writtenNotes.length > 0) ||
        ingestDetail.usageLine ||
        ingestDetail.verificationWarning));

  const ingestBanner = showIngestBanner ? (
    <div className="journal-ingest-banner">
      {ingestErr && <p className="journal-ingest-msg err">{ingestErr}</p>}
      {!ingestErr && ingestMsg && <p className="journal-ingest-msg ok">{ingestMsg}</p>}
      {!ingestErr && ingestDetail?.writtenNotes?.length > 0 && (
        <>
          <p className="journal-ingest-files-label muted">Обновлённые файлы:</p>
          <ul className="journal-ingest-files">
            {ingestDetail.writtenNotes.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      {!ingestErr && ingestDetail?.verificationWarning ? (
        <p className="journal-ingest-msg err">{ingestDetail.verificationWarning}</p>
      ) : null}
      {!ingestErr && ingestDetail?.usageLine ? (
        <p className="journal-ingest-usage muted">{ingestDetail.usageLine}</p>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="split-page">
      <div className="card list-page">
        {days.map((day) => (
          <button
            className={'item ' + (selectedDay === day ? 'active' : '')}
            key={day}
            onClick={() => openDay(day)}
          >
            {formatJournalDayLabel(day)}
          </button>
        ))}
        {days.length === 0 && <p className="muted">Журнал пока пуст.</p>}
      </div>
      <div className="desktop-reader">
        {entries ? (
          <ReaderPane
            title={formatJournalDayLabel(selectedDay)}
            meta={entries.length + ' entries'}
            actions={ingestActions}
          >
            {ingestBanner}
            <JournalEntries
              entries={entries}
              onToggleExclude={toggleExclude}
              excludedBusyId={excludeBusyId}
            />
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
          title={formatJournalDayLabel(selectedDay)}
          meta={entries.length + ' entries'}
          actions={ingestActions}
          onClose={() => {
            setEntries(null);
            setSelectedDay('');
          }}
        >
          {ingestBanner}
          <JournalEntries
            entries={entries}
            onToggleExclude={toggleExclude}
            excludedBusyId={excludeBusyId}
          />
        </ReaderModal>
      )}
    </div>
  );
}

function ReminderDayModal({ dayLabel, items, onClose, cronTz }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="reminder-day-modal" role="dialog" aria-modal="true" aria-labelledby="reminder-day-title">
      <button
        type="button"
        className="reminder-day-modal__backdrop"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <div className="reminder-day-modal__panel">
        <header className="reminder-day-modal__head">
          <strong id="reminder-day-title">{dayLabel}</strong>
          <button
            type="button"
            className="reminder-day-modal__close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </header>
        <div className="reminder-day-modal__body">
          {items.length === 0 && (
            <p className="muted">На этот день нет напоминаний.</p>
          )}
          {items.map((item) => (
            <article className="reminder-item" key={item.id}>
              <div className="reminder-main">
                <strong>{item.text}</strong>
              </div>
              <div className="reminder-meta">
                <span>{fmtTime(item.fire_at)}</span>
                {item.recurrence?.cron && (
                  <code>
                    {item.recurrence.cron}
                    {item.recurrence.tz || cronTz
                      ? ` (${item.recurrence.tz || cronTz})`
                      : ''}
                  </code>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function Reminders({ api }) {
  const [state, setState] = useState({ loading: true, error: '', tz: '', reminders: [] });
  const [monthOffset, setMonthOffset] = useState(0);
  const [dayModal, setDayModal] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/reminders')
      .then((data) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: '',
          tz: data.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          reminders: Array.isArray(data.reminders) ? data.reminders : [],
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ loading: false, error: err.message, tz: '', reminders: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const monthData = useMemo(() => {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const year = base.getFullYear();
    const month = base.getMonth();
    const firstDay = new Date(year, month, 1);
    const startWeekday = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startWeekday; i += 1) cells.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) {
      cells.push(new Date(year, month, d));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return { base, cells };
  }, [monthOffset]);

  function dayKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const remindersByDay = useMemo(() => {
    const byDay = new Map();
    for (const reminder of state.reminders) {
      const dt = new Date(reminder.fire_at);
      if (Number.isNaN(dt.getTime())) continue;
      const key = dayKey(dt);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(reminder);
    }
    return byDay;
  }, [state.reminders]);

  const upcoming = useMemo(
    () =>
      [...state.reminders]
        .sort((a, b) => new Date(a.fire_at) - new Date(b.fire_at))
        .slice(0, 12),
    [state.reminders]
  );

  if (state.loading) return <div className="card muted">Loading reminders...</div>;
  if (state.error) return <pre>{state.error}</pre>;

  return (
    <div className="reminders-page">
      {dayModal && (
        <ReminderDayModal
          dayLabel={dayModal.label}
          items={dayModal.items}
          onClose={() => setDayModal(null)}
          cronTz={state.tz}
        />
      )}
      <section className="card">
        <div className="reminders-head">
          <div>
            <h2>
              {monthData.base.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
            </h2>
          </div>
          <div className="actions">
            <button className="secondary" onClick={() => setMonthOffset((v) => v - 1)}>←</button>
            <button className="secondary" onClick={() => setMonthOffset(0)}>Сегодня</button>
            <button className="secondary" onClick={() => setMonthOffset((v) => v + 1)}>→</button>
          </div>
        </div>
        <div className="calendar-weekdays">
          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((name) => (
            <div key={name}>{name}</div>
          ))}
        </div>
        <div className="calendar-grid">
          {monthData.cells.map((date, idx) => {
            if (!date) return <div key={idx} className="calendar-cell empty" />;
            const key = dayKey(date);
            const dayReminders = remindersByDay.get(key) || [];
            const count = dayReminders.length;
            const today = dayKey(new Date()) === key;
            return (
              <button
                type="button"
                key={idx}
                className={'calendar-cell calendar-cell--btn' + (today ? ' today' : '')}
                onClick={() =>
                  setDayModal({
                    label: formatReminderDayModalLabel(date),
                    items: dayReminders,
                  })
                }
              >
                <div className="calendar-day">{date.getDate()}</div>
                <div className="calendar-dots">
                  {count > 0 ? (
                    <>
                      <span className="dot-fill" />
                      <small>{count}</small>
                    </>
                  ) : (
                    <small className="muted">—</small>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Ближайшие напоминания</h2>
          <span className="muted">{state.reminders.length} всего</span>
        </div>
        <div className="reminders-list">
          {upcoming.length === 0 && <p className="muted">Пока нет активных напоминаний.</p>}
          {upcoming.map((item) => (
            <article className="reminder-item" key={item.id}>
              <div className="reminder-main">
                <strong>{item.text}</strong>
              </div>
              <div className="reminder-meta">
                <span>{fmtTime(item.fire_at)}</span>
                {item.recurrence?.cron && (
                  <code>{item.recurrence.cron} ({item.recurrence.tz || state.tz})</code>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Atlas({ api, token, setStateText }) {
  const [ready, setReady] = useState(false);
  const [src, setSrc] = useState('');

  useEffect(() => {
    setStateText('building...');
    api.get('/api/atlas').then((atlas) => {
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
  const logScrollRef = useRef(null);

  const displayLog =
    (log?.running ? '[running]\n' : '') + (log?.content || 'No update log yet.');

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

  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [displayLog]);

  return (
    <div className="stack update-page">
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
      <div className="card update-log-card">
        <h3 className="update-log-heading">Лог обновления</h3>
        <div className="update-log-scroll" ref={logScrollRef}>
          <pre className="update-log-pre">{displayLog}</pre>
        </div>
      </div>
    </div>
  );
}

function App() {
  const api = useApi();
  const design = useDesignSystem(api);
  const [view, setView] = useState('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [stateText, setStateText] = useState('');

  useEffect(() => {
    setStateText('');
  }, [view]);

  const title = navItems.find(([id]) => id === view)?.[1] || 'Dashboard';

  function navigate(id) {
    setView(id);
    setMenuOpen(false);
  }

  async function switchPreset(id) {
    if (!id || !design || !design.activatePreset) return;
    try {
      await design.activatePreset(id);
      setStateText('Тема применена');
    } catch (err) {
      setStateText('Ошибка темы: ' + (err && err.message ? err.message : String(err)));
    }
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
        <section className="side-presets" aria-label="Пресеты темы">
          <div className="side-presets-head">Пресеты</div>
          {design.loading ? (
            <p className="muted side-presets-empty">Загрузка…</p>
          ) : (design.presets || []).length === 0 ? (
            <p className="muted side-presets-empty">Пока только базовый пресет.</p>
          ) : (
            <ul className="side-presets-list">
              {(design.presets || []).map((preset) => (
                <li key={preset.id}>
                  <button
                    type="button"
                    className={
                      'side-preset-chip' +
                      (design.activePresetId === preset.id ? ' side-preset-chip-active' : '')
                    }
                    onClick={() => switchPreset(preset.id)}
                  >
                    {preset.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="muted side-footnote">Dashboard for notes, projects, journal, and agent state.</p>
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
          {view === 'home' && <Home api={api} setStateText={setStateText} setView={setView} />}
          {view === 'flow' && <AgentFlowDiagram />}
          {view === 'status' && <StatusPanel api={api} />}
          {view === 'settings' && <SettingsPanel api={api} design={design} />}
          {view === 'atlas' && <Atlas api={api} token={api.token} setStateText={setStateText} />}
          {view === 'notes' && <FileBrowser api={api} kind="note" desktopDetail />}
          {view === 'summaries' && <FileBrowser api={api} kind="summary" desktopDetail />}
          {view === 'journal' && <Journal api={api} />}
          {view === 'reminders' && <Reminders api={api} />}
          {view === 'update' && <UpdatePanel api={api} />}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
