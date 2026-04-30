import React, {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { SettingsPanel } from './settings_panel.jsx';
import { AgentFlowDiagram } from './agent_flow.jsx';
import { StatusPanel } from './status_panel.jsx';
import { BatterySnapshotBlock } from './battery_snapshot.jsx';
import { formatBalanceMain, formatBalanceSubtitle } from './openrouter_money.js';
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

/** Пн=0 … Вс=6 в UI → поле day-of-week в cron (0=вс, 1=пн …). */
const UI_MON_FIRST_TO_CRON_DOW = [1, 2, 3, 4, 5, 6, 0];

function cronDowToUiIndex(cronDow) {
  const n = Number(cronDow);
  if (n === 0 || n === 7) return 6;
  if (n >= 1 && n <= 6) return n - 1;
  return -1;
}

/** Разбор только простых weekly cron `m h * * dow` (списки и диапазоны в dow). */
function parseSimpleWeeklyCron(expr) {
  const m = String(expr || '')
    .trim()
    .match(/^(\d{1,2}) (\d{1,2}) \* \* ([\d*,\-]+)$/);
  if (!m) return null;
  const minute = Number(m[1]);
  const hour = Number(m[2]);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const sel = [false, false, false, false, false, false, false];
  for (const part of m[3].split(',')) {
    const p = part.trim();
    if (!p) continue;
    if (p.includes('-')) {
      const [a, b] = p.split('-').map((x) => Number(String(x).trim()));
      if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
      for (let d = Math.min(a, b); d <= Math.max(a, b); d += 1) {
        const ui = cronDowToUiIndex(d);
        if (ui < 0) return null;
        sel[ui] = true;
      }
    } else {
      const d = Number(p);
      if (!Number.isInteger(d)) return null;
      const ui = cronDowToUiIndex(d);
      if (ui < 0) return null;
      sel[ui] = true;
    }
  }
  if (!sel.some(Boolean)) return null;
  return { minute, hour, dowSelected: sel };
}

function buildWeeklyCronFromUi(hour, minute, dowSelected) {
  const parts = [];
  dowSelected.forEach((on, i) => {
    if (on) parts.push(UI_MON_FIRST_TO_CRON_DOW[i]);
  });
  parts.sort((a, b) => a - b);
  if (parts.length === 0) {
    throw new Error('Выбери хотя бы один день недели.');
  }
  return `${minute} ${hour} * * ${parts.join(',')}`;
}

function formatWeeklyCronHuman(cron, tz) {
  const p = parseSimpleWeeklyCron(cron);
  if (!p) return cron;
  const names = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
  const days = p.dowSelected.map((on, i) => (on ? names[i] : null)).filter(Boolean);
  const dayStr = days.join(', ');
  return `${dayStr} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}${tz ? ` (${tz})` : ''}`;
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

/** posix parent directory; '' если файл в корне memory/notes */
function noteFolderKey(name) {
  const norm = String(name || '').replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i <= 0 ? '' : norm.slice(0, i);
}

/** Имя файла из относительного пути posix */
function basenamePosix(norm) {
  const n = String(norm || '').replace(/\\/g, '/');
  const i = n.lastIndexOf('/');
  return i < 0 ? n : n.slice(i + 1);
}

const NOTE_FOLDER_LABELS = {
  '': 'Корень',
  projects: 'Проекты',
  archive: 'Архив',
  summaries: 'Сводки по дням',
  inbox: 'Инбокс и системные',
};

function labelForFolder(folder) {
  if (folder === '' || folder === '.') return NOTE_FOLDER_LABELS[''];
  const known = NOTE_FOLDER_LABELS[folder];
  if (known) return known;
  const top = folder.split('/')[0];
  const tl = NOTE_FOLDER_LABELS[top];
  const rest = folder.slice(top.length).replace(/^\//, '');
  if (tl && rest) return `${tl} → ${rest.replace(/_/g, ' ')}`;
  return folder.replace(/_/g, ' ');
}

/** Заголовки в списке Notes / заголовок панели чтения (без .md-хаков) */
function humanizeSlugBase(baseSansMd) {
  const s = String(baseSansMd || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return baseSansMd;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatNoteBrowserTitle(note, kind) {
  if (kind === 'summary') return formatSummaryMenuLabel(note.name);
  const bn = basenamePosix(note.name);
  const base = bn.replace(/\.md$/i, '');
  return humanizeSlugBase(base);
}

function formatNoteReaderTitle(name, kind) {
  if (kind === 'summary') return formatSummaryTitleLabel(name);
  const base = basenamePosix(name).replace(/\.md$/i, '');
  return humanizeSlugBase(base);
}

/** Группы для левого списка Notes / Summaries (папки первого уровня и вложенные) */
function groupNotesByFolderForBrowser(notes) {
  const map = new Map();
  for (const note of notes) {
    const folder =
      typeof note.folder === 'string'
        ? note.folder
        : noteFolderKey(note.name);
    if (!map.has(folder)) map.set(folder, []);
    map.get(folder).push(note);
  }
  const folders = [...map.keys()].sort((a, b) => {
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b, 'ru');
  });
  return folders.map((folder) => ({
    folder,
    label: labelForFolder(folder),
    notes: map.get(folder).sort((x, y) => String(x.name).localeCompare(String(y.name), 'ru')),
  }));
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

/** Разбор *курсива* вне кода и ссылок; не трогает **. */
function parseItalicOnly(text, keyPrefix) {
  const result = [];
  if (!text) return result;
  const re = /\*([^*]+)\*/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      result.push(text.slice(last, m.index));
    }
    result.push(
      <em key={`${keyPrefix}-em-${k++}`}>{m[1]}</em>
    );
    last = re.lastIndex;
  }
  if (last < text.length) {
    result.push(text.slice(last));
  }
  return result.length ? result : [text];
}

/** Ссылки [label](url) и курсив в оставшемся тексте. */
function parseLinksAndItalic(text, keyPrefix) {
  if (!text) return [];
  const nodes = [];
  const linkRe = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let pos = 0;
  let m;
  let idx = 0;
  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > pos) {
      nodes.push(
        ...parseItalicOnly(text.slice(pos, m.index), `${keyPrefix}-b-${idx}`)
      );
    }
    nodes.push(
      <a
        key={`${keyPrefix}-a-${idx}`}
        href={m[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="md-link"
      >
        {m[1]}
      </a>
    );
    pos = m.index + m[0].length;
    idx++;
  }
  if (pos < text.length) {
    nodes.push(...parseItalicOnly(text.slice(pos), `${keyPrefix}-tail`));
  }
  return nodes.length ? nodes : parseItalicOnly(text, keyPrefix);
}

function expandInlineSegment(segment, keyPrefix, codeStore) {
  const parts = segment.split(/\x00CODE(\d+)\x00/);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      const code = codeStore[Number(parts[i])];
      out.push(
        <code key={`${keyPrefix}-c-${i}`} className="md-inline-code">
          {code}
        </code>
      );
    } else {
      out.push(...parseLinksAndItalic(parts[i], `${keyPrefix}-t-${i}`));
    }
  }
  return out;
}

/**
 * Инлайн: `код`, **жирный**, *курсив*, [текст](url).
 * Порядок: код → жирный → ссылки и курсив внутри сегментов.
 */
function renderInlineMarkdown(text, keyPrefix = 'inl') {
  const str = String(text ?? '');
  if (!str) return null;

  const codeStore = [];
  const masked = str.replace(/`([^`]+)`/g, (_, code) => {
    const id = codeStore.length;
    codeStore.push(code);
    return `\x00CODE${id}\x00`;
  });

  const boldParts = masked.split(/\*\*/);
  const nodes = [];
  boldParts.forEach((seg, bi) => {
    const subKey = `${keyPrefix}-b${bi}`;
    const inner = expandInlineSegment(seg, subKey, codeStore);
    if (bi % 2 === 1) {
      nodes.push(<strong key={subKey}>{inner}</strong>);
    } else {
      nodes.push(...inner);
    }
  });

  return nodes.length ? nodes : null;
}

/** Читабельный markdown для сводок и заметок (без таблиц и HTML). */
function MarkdownDoc({ text }) {
  const lines = String(text || '').split(/\r?\n/);
  const blocks = [];
  let i = 0;
  let listMode = null;
  let listItems = [];

  function flushList() {
    if (!listMode || listItems.length === 0) {
      listMode = null;
      listItems = [];
      return;
    }
    blocks.push({ type: listMode, items: [...listItems] });
    listMode = null;
    listItems = [];
  }

  while (i < lines.length) {
    const t = lines[i].trim();

    if (!t) {
      flushList();
      i++;
      continue;
    }

    if (/^(\*{3,}|-{3,}|_{3,})$/.test(t)) {
      flushList();
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (t.startsWith('#### ')) {
      flushList();
      blocks.push({ type: 'h4', text: t.slice(5).trim() });
      i++;
      continue;
    }
    if (t.startsWith('### ')) {
      flushList();
      blocks.push({ type: 'h3', text: t.slice(4).trim() });
      i++;
      continue;
    }
    if (t.startsWith('## ')) {
      flushList();
      blocks.push({ type: 'h2', text: t.slice(3).trim() });
      i++;
      continue;
    }
    if (t.startsWith('# ')) {
      flushList();
      blocks.push({ type: 'h1', text: t.slice(2).trim() });
      i++;
      continue;
    }

    if (t.startsWith('>')) {
      flushList();
      const quoteLines = [];
      while (i < lines.length) {
        const lt = lines[i].trim();
        if (!lt) break;
        if (lt.startsWith('>')) {
          quoteLines.push(lt.replace(/^>\s?/, '').trim());
          i++;
        } else break;
      }
      blocks.push({ type: 'blockquote', lines: quoteLines });
      continue;
    }

    const olMatch = t.match(/^(\d+)\.\s+(.*)$/);
    if (olMatch) {
      if (listMode !== 'ol') {
        flushList();
        listMode = 'ol';
      }
      listItems.push(olMatch[2]);
      i++;
      continue;
    }

    if (/^-\s+/.test(t)) {
      if (listMode !== 'ul') {
        flushList();
        listMode = 'ul';
      }
      listItems.push(t.replace(/^-\s+/, ''));
      i++;
      continue;
    }

    if (/^\*\s+/.test(t) && !t.startsWith('**')) {
      if (listMode !== 'ul') {
        flushList();
        listMode = 'ul';
      }
      listItems.push(t.replace(/^\*\s+/, ''));
      i++;
      continue;
    }

    flushList();

    const paraLines = [t];
    i++;
    while (i < lines.length) {
      const nt = lines[i].trim();
      if (!nt) break;
      if (
        nt.startsWith('#') ||
        nt.startsWith('>') ||
        /^(\*{3,}|-{3,}|_{3,})$/.test(nt) ||
        /^-\s+/.test(nt) ||
        (/^\*\s+/.test(nt) && !nt.startsWith('**')) ||
        /^\d+\.\s+/.test(nt)
      ) {
        break;
      }
      paraLines.push(nt);
      i++;
    }
    blocks.push({ type: 'p', lines: paraLines });
  }

  flushList();

  return (
    <div className="md-doc">
      {blocks.map((block, index) => {
        const key = `blk-${index}`;
        if (block.type === 'hr') {
          return <hr key={key} className="md-hr" />;
        }
        if (block.type === 'h1') {
          return (
            <h1 key={key}>{renderInlineMarkdown(block.text, `${key}-h1`)}</h1>
          );
        }
        if (block.type === 'h2') {
          return (
            <h2 key={key}>{renderInlineMarkdown(block.text, `${key}-h2`)}</h2>
          );
        }
        if (block.type === 'h3') {
          return (
            <h3 key={key}>{renderInlineMarkdown(block.text, `${key}-h3`)}</h3>
          );
        }
        if (block.type === 'h4') {
          return (
            <h4 key={key}>{renderInlineMarkdown(block.text, `${key}-h4`)}</h4>
          );
        }
        if (block.type === 'blockquote') {
          return (
            <blockquote key={key} className="md-blockquote">
              {block.lines.map((qline, qi) => (
                <p key={`${key}-q-${qi}`}>
                  {renderInlineMarkdown(qline, `${key}-qb-${qi}`)}
                </p>
              ))}
            </blockquote>
          );
        }
        if (block.type === 'ul') {
          return (
            <ul key={key}>
              {block.items.map((item, ii) => (
                <li key={`${key}-li-${ii}`}>
                  {renderInlineMarkdown(item, `${key}-uli-${ii}`)}
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === 'ol') {
          return (
            <ol key={key}>
              {block.items.map((item, ii) => (
                <li key={`${key}-oli-${ii}`}>
                  {renderInlineMarkdown(item, `${key}-oli-${ii}`)}
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={key} className="md-paragraph">
            {block.lines.map((line, li) => (
              <Fragment key={`${key}-ln-${li}`}>
                {li > 0 ? <br /> : null}
                {renderInlineMarkdown(line, `${key}-ln-${li}`)}
              </Fragment>
            ))}
          </p>
        );
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

/** Текст секции «Мои мысли» … до «На завтра» в сводке (summaries/summary-*.md). */
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

/** Батарея + остаток OpenRouter — низ левой панели. */
function SideStatusFooter({ api }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const s = await api.get('/api/status');
        if (!cancelled) setStatus(s);
      } catch {
        if (!cancelled) setStatus(null);
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [api]);

  if (!status) {
    return (
      <footer className="side-status-footer">
        <p className="muted side-status-muted">Статус…</p>
      </footer>
    );
  }

  const or = status.openrouter;

  return (
    <footer className="side-status-footer" aria-label="Батарея и баланс">
      <div className="side-status-block">
        <div className="side-status-label">Батарея</div>
        <BatterySnapshotBlock battery={status.battery} compact />
      </div>
      <div className="side-status-block">
        <div className="side-status-label">Остаток OpenRouter</div>
        <div className="side-balance-values">
          <strong title="limit_remaining, USD (GET /api/v1/key)">
            {formatBalanceMain(or)}
          </strong>
          <small className="muted">
            {or?.ok
              ? formatBalanceSubtitle(or) ||
                (or.currency === 'USD' ? 'суммы в USD с панели ключа' : 'лимит / расход')
              : or?.error || 'данные ключа недоступны'}
          </small>
        </div>
      </div>
    </footer>
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const kindLabel = kind === 'summary' ? 'сводку' : 'файл';
  const selectedStorageKey = 'galaxy-dashboard-selected-' + kind;
  const selectedDisplayTitle = selected
    ? formatNoteReaderTitle(selected, kind)
    : '';

  const refreshNoteList = useCallback(() => {
    return api.get('/api/notes').then((data) => {
      setNotes(data.notes.filter((note) => note.kind === kind));
    });
  }, [api, kind]);

  useEffect(() => {
    refreshNoteList();
  }, [refreshNoteList]);

  const groups = useMemo(() => groupNotesByFolderForBrowser(notes), [notes]);

  useEffect(() => {
    if (!notes.length) return;
    const saved = localStorage.getItem(selectedStorageKey) || '';
    if (!saved) return;
    if (!notes.some((note) => note.name === saved)) return;
    openNote(saved);
  }, [notes]);

  async function openNote(name) {
    setEditing(false);
    setSaveError('');
    setSelected(name);
    localStorage.setItem(selectedStorageKey, name);
    const note = await api.get('/api/note?name=' + encodeURIComponent(name));
    setContent(note.content);
    setDraft(note.content);
  }

  function beginEditFile() {
    setSaveError('');
    setDraft(content);
    setEditing(true);
  }

  function cancelEditFile() {
    setSaveError('');
    setDraft(content);
    setEditing(false);
  }

  async function saveFile() {
    if (!selected) return;
    setSaveBusy(true);
    setSaveError('');
    try {
      await api.post('/api/notes/save', { name: selected, content: draft });
      setContent(draft);
      setEditing(false);
      await refreshNoteList();
    } catch (e) {
      setSaveError(e && e.message ? e.message : String(e));
    } finally {
      setSaveBusy(false);
    }
  }

  const fileReaderActions =
    (kind === 'summary' || kind === 'note') && selected ? (
      <div className="reader-file-actions">
        {!editing ? (
          <button type="button" className="secondary" onClick={beginEditFile}>
            Редактировать
          </button>
        ) : (
          <>
            <button
              type="button"
              className="secondary"
              disabled={saveBusy}
              onClick={cancelEditFile}
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={saveBusy || draft === content}
              onClick={saveFile}
            >
              {saveBusy ? 'Сохранение…' : 'Сохранить'}
            </button>
          </>
        )}
      </div>
    ) : null;

  function renderNoteBody() {
    const editMode = editing && (kind === 'summary' || kind === 'note');
    if (editMode) {
      return (
        <>
          {saveError && <p className="md-save-err">{saveError}</p>}
          <textarea
            className="md-raw-editor"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            aria-label={kind === 'summary' ? 'Текст сводки' : 'Текст заметки'}
          />
        </>
      );
    }
    if (kind === 'summary' || kind === 'note') {
      return <MarkdownDoc text={content} />;
    }
    return <pre>{content}</pre>;
  }

  return (
    <div className={desktopDetail ? 'split-page' : ''}>
      <div className="card list-page file-browser-list">
        {groups.length > 0 &&
          groups.map((group) => (
            <section key={group.folder || '__root__'} className="file-browser-group">
              <h3 className="file-browser-group-title">{group.label}</h3>
              <div className="file-browser-group-items">
                {group.notes.map((note) => (
                  <button
                    type="button"
                    className={'item ' + (selected === note.name ? 'active' : '')}
                    key={note.name}
                    onClick={() => openNote(note.name)}
                  >
                    <div className="item-title-line">
                      <strong>{formatNoteBrowserTitle(note, kind)}</strong>
                      <span className="item-meta-right">
                        {kind === 'summary'
                          ? formatSummaryMetaLabel(note.name, note.mtime)
                          : fmtTime(note.mtime)}
                      </span>
                    </div>
                    {noteFolderKey(note.name) !== '' && (
                      <span className="item-note-path" title={note.name}>
                        {note.name}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))}
        {notes.length === 0 && <p className="muted">Файлов пока нет.</p>}
      </div>
      {desktopDetail && (
        <div className="desktop-reader">
          {selected ? (
            <ReaderPane
              title={selectedDisplayTitle}
              meta={kind}
              actions={fileReaderActions}
            >
              {renderNoteBody()}
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
          onClose={() => {
            setSelected(null);
            setEditing(false);
            setSaveError('');
          }}
          actions={fileReaderActions}
        >
          {renderNoteBody()}
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
                <span>
                  {item.recurrence?.cron
                    ? `След.: ${fmtTime(item.fire_at)}`
                    : fmtTime(item.fire_at)}
                </span>
                {item.recurrence?.cron && (
                  <code>
                    {formatWeeklyCronHuman(item.recurrence.cron, item.recurrence.tz || cronTz)}{' '}
                    <span className="muted">[{item.recurrence.cron}]</span>
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

const WEEKDAY_LABELS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function RecurringEventModal({ open, initial, tzDefault, saving, errorText, onClose, onSubmit }) {
  const [text, setText] = useState('');
  const [minute, setMinute] = useState(0);
  const [hour, setHour] = useState(9);
  const [dow, setDow] = useState(() => [true, false, false, false, true, false, false]);
  const [cronRaw, setCronRaw] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [tzUse, setTzUse] = useState('Europe/Moscow');

  useEffect(() => {
    if (!open) return;
    const tzz = tzDefault || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    setTzUse(tzz);
    if (!initial) {
      setText('');
      setMinute(0);
      setHour(9);
      setDow([true, false, false, false, false, false, false]);
      setCronRaw(`0 9 * * 1`);
      setAdvanced(false);
      return;
    }
    setText(initial.text || '');
    const cron = initial.recurrence?.cron || '';
    const parsed = parseSimpleWeeklyCron(cron);
    const recTz = initial.recurrence?.tz || tzz;
    setTzUse(recTz);
    if (parsed) {
      setAdvanced(false);
      setMinute(parsed.minute);
      setHour(parsed.hour);
      setDow(parsed.dowSelected);
      setCronRaw(cron);
    } else {
      setAdvanced(true);
      setCronRaw(cron || '0 9 * * 1');
    }
  }, [open, initial, tzDefault]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function toggleDow(i) {
    const next = [...dow];
    next[i] = !next[i];
    setDow(next);
  }

  async function handleSave(e) {
    e.preventDefault();
    const cron = advanced
      ? String(cronRaw || '').trim()
      : buildWeeklyCronFromUi(hour, minute, dow);
    if (!cron) return;
    if (!text.trim()) return;
    const ok = await onSubmit({
      text: text.trim(),
      cron,
      tz: String(tzUse || '').trim() || tzDefault,
      id: initial && initial.id,
    });
    if (ok) onClose();
  }

  return (
    <div className="reminder-day-modal" role="dialog" aria-modal="true">
      <button type="button" className="reminder-day-modal__backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="reminder-day-modal__panel recurring-modal-panel">
        <header className="reminder-day-modal__head">
          <strong>{initial ? 'Редактировать расписание' : 'Новое регулярное напоминание'}</strong>
          <button type="button" className="reminder-day-modal__close" onClick={onClose}>
            ×
          </button>
        </header>
        <form className="recurring-modal-form" onSubmit={handleSave}>
          <label className="recurring-field">
            <span>Текст</span>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ушу, репетиция…"
              required
            />
          </label>
          {!advanced ? (
            <>
              <div className="recurring-field">
                <span>Дни недели</span>
                <div className="weekday-toggles">
                  {WEEKDAY_LABELS_RU.map((lbl, i) => (
                    <label key={lbl} className="weekday-chip">
                      <input type="checkbox" checked={dow[i]} onChange={() => toggleDow(i)} />
                      {lbl}
                    </label>
                  ))}
                </div>
              </div>
              <div className="recurring-field recurring-time-row">
                <label>
                  <span>Час</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={hour}
                    onChange={(e) => setHour(Number(e.target.value))}
                  />
                </label>
                <label>
                  <span>Мин.</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={minute}
                    onChange={(e) => setMinute(Number(e.target.value))}
                  />
                </label>
              </div>
            </>
          ) : (
            <label className="recurring-field">
              <span>Cron (5 полей POSIX)</span>
              <input
                value={cronRaw}
                onChange={(e) => setCronRaw(e.target.value)}
                placeholder="0 9 * * 1,5"
                spellCheck={false}
              />
            </label>
          )}
          <label className="recurring-field">
            <span>Часовой пояс</span>
            <input value={tzUse} onChange={(e) => setTzUse(e.target.value)} spellCheck={false} />
          </label>
          <label className="recurring-checkbox">
            <input
              type="checkbox"
              checked={advanced}
              onChange={(e) => setAdvanced(e.target.checked)}
            />
            Расширенный режим (свой cron)
          </label>
          {errorText ? <p className="recurring-form-error">{errorText}</p> : null}
          <footer className="recurring-modal-footer">
            <button type="button" className="secondary" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="secondary reminder-accent-btn" disabled={saving}>
              {saving ? 'Сохраняю…' : 'Сохранить'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function reminderPausedUntil(rem) {
  if (!rem.paused_until) return null;
  const t = new Date(rem.paused_until).getTime();
  if (Number.isNaN(t) || Date.now() >= t) return null;
  return rem.paused_until;
}

function Reminders({ api }) {
  const [state, setState] = useState({
    loading: true,
    error: '',
    tz: '',
    reminders: [],
    calendarByDay: null,
  });
  const [monthOffset, setMonthOffset] = useState(0);
  const [dayModal, setDayModal] = useState(null);
  const [editor, setEditor] = useState(null);
  const [actionBusyId, setActionBusyId] = useState('');
  const [formError, setFormError] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);

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
    const calendarYm = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
    return { base, cells, calendarYm };
  }, [monthOffset]);

  const reload = useCallback(async () => {
    const cal = `/api/reminders?calendar=${encodeURIComponent(monthData.calendarYm)}`;
    try {
      const data = await api.get(cal);
      setState(() => ({
        loading: false,
        error: '',
        tz: data.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        reminders: Array.isArray(data.reminders) ? data.reminders : [],
        calendarByDay: data.calendar_by_day || null,
      }));
    } catch (err) {
      setState((prev) => ({
        loading: false,
        error: err.message,
        tz: prev.tz || '',
        reminders: prev.reminders.length ? prev.reminders : [],
        calendarByDay: prev.reminders.length ? prev.calendarByDay : null,
      }));
    }
  }, [api, monthData.calendarYm]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cal = `/api/reminders?calendar=${encodeURIComponent(monthData.calendarYm)}`;
        const data = await api.get(cal);
        if (cancelled) return;
        setState({
          loading: false,
          error: '',
          tz: data.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          reminders: Array.isArray(data.reminders) ? data.reminders : [],
          calendarByDay: data.calendar_by_day || null,
        });
      } catch (err) {
        if (!cancelled) {
          setState({ loading: false, error: err.message, tz: '', reminders: [], calendarByDay: null });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, monthData.calendarYm]);

  function dayKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const remindersById = useMemo(() => {
    const m = new Map();
    for (const r of state.reminders) m.set(r.id, r);
    return m;
  }, [state.reminders]);

  const remindersByDay = useMemo(() => {
    const byDay = new Map();
    if (state.calendarByDay && typeof state.calendarByDay === 'object') {
      for (const [k, tiny] of Object.entries(state.calendarByDay)) {
        const full = (Array.isArray(tiny) ? tiny : [])
          .map((t) => remindersById.get(t.id) || t)
          .filter(Boolean);
        if (full.length) byDay.set(k, full);
      }
      return byDay;
    }
    for (const reminder of state.reminders) {
      const dt = new Date(reminder.fire_at);
      if (Number.isNaN(dt.getTime())) continue;
      const key = dayKey(dt);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(reminder);
    }
    return byDay;
  }, [state.reminders, state.calendarByDay, remindersById]);

  const upcoming = useMemo(
    () =>
      [...state.reminders]
        .sort((a, b) => new Date(a.fire_at) - new Date(b.fire_at))
        .slice(0, 12),
    [state.reminders]
  );

  const recurringList = useMemo(
    () => state.reminders.filter((r) => r.recurrence && r.recurrence.cron),
    [state.reminders]
  );

  async function saveRecurring({ text, cron, tz, id }) {
    setFormError('');
    setSaveBusy(true);
    try {
      if (id) {
        await api.post('/api/reminders/update', {
          id,
          text,
          cron,
          tz,
        });
      } else {
        await api.post('/api/reminders/add', { text, cron, tz });
      }
      await reload();
      return true;
    } catch (e) {
      setFormError(e.message || String(e));
      return false;
    } finally {
      setSaveBusy(false);
    }
  }

  async function updateOne(id, body) {
    setActionBusyId(id);
    try {
      await api.post('/api/reminders/update', { id, ...body });
      await reload();
    } finally {
      setActionBusyId('');
    }
  }

  async function deleteOne(id) {
    if (!window.confirm('Удалить это напоминание?')) return;
    setActionBusyId(id);
    try {
      await api.post('/api/reminders/delete', { id });
      await reload();
    } finally {
      setActionBusyId('');
    }
  }

  async function pauseWeek(id) {
    const until = new Date(Date.now() + 7 * 86400000).toISOString();
    await updateOne(id, { paused_until: until });
  }

  if (state.loading && state.reminders.length === 0) {
    return <div className="card muted">Loading reminders...</div>;
  }
  if (state.error && state.reminders.length === 0) return <pre>{state.error}</pre>;

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
      <RecurringEventModal
        open={editor != null}
        initial={typeof editor === 'object' && editor && editor.id ? editor : null}
        tzDefault={state.tz}
        saving={saveBusy}
        errorText={formError}
        onClose={() => {
          setEditor(null);
          setFormError('');
        }}
        onSubmit={saveRecurring}
      />
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
        {state.error && state.reminders.length > 0 ? (
          <p className="reminders-soft-error">{state.error}</p>
        ) : null}
      </section>

      <div className="reminders-side-stack">
        <section className="card">
          <div className="section-head">
            <h2>Ближайшие напоминания</h2>
            <span className="muted">{state.reminders.length} всего</span>
          </div>
          <div className="reminders-list">
            {upcoming.length === 0 && (
              <p className="muted">Пока нет активных напоминаний.</p>
            )}
            {upcoming.map((item) => (
              <article className="reminder-item" key={item.id}>
                <div className="reminder-main">
                  <strong>{item.text}</strong>
                  {(!item.enabled || reminderPausedUntil(item)) && (
                    <span className="reminder-pill-muted">нет уведомлений</span>
                  )}
                </div>
                <div className="reminder-meta">
                  <span>{fmtTime(item.fire_at)}</span>
                  {item.recurrence?.cron && (
                    <code>{formatWeeklyCronHuman(item.recurrence.cron, item.recurrence.tz || state.tz)}</code>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="section-head reminders-recurring-head">
            <h2>Регулярные события</h2>
            <button
              type="button"
              className="secondary reminder-accent-btn"
              onClick={() => {
                setFormError('');
                setEditor('add');
              }}
            >
              + Добавить
            </button>
          </div>
          <p className="muted recurring-hint">
            Правила по дням недели (cron). Совпадающие слоты отмечаются на календаре на весь месяц.
            Отключение — без удаления; «Пауза» — временно без уведомлений до даты.
          </p>
          <div className="reminders-list">
            {recurringList.length === 0 ? (
              <p className="muted">Ещё нет регулярных напоминаний — добавь первое или спроси агента.</p>
            ) : (
              recurringList.map((item) => {
                const paused = reminderPausedUntil(item);
                const busyHere = actionBusyId === item.id;
                const status = [];
                if (item.enabled === false) status.push('выключено');
                else if (paused) status.push(`пауза до ${fmtTime(paused)}`);
                else status.push('активно');
                return (
                  <article className="reminder-item recurring-item" key={item.id}>
                    <div className="reminder-main">
                      <strong>{item.text}</strong>
                      <span className={`reminder-status ${item.enabled === false ? 'off' : paused ? 'pause' : 'on'}`}>
                        {busyHere ? '…' : status.join(' · ')}
                      </span>
                    </div>
                    <div className="reminder-meta recurring-item-meta">
                      <span>Следующий слот: {fmtTime(item.fire_at)}</span>
                      <code>{formatWeeklyCronHuman(item.recurrence.cron, item.recurrence.tz || state.tz)}</code>
                    </div>
                    <div className="recurring-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={busyHere}
                        onClick={() => {
                          setFormError('');
                          setEditor(item);
                        }}
                      >
                        Править
                      </button>
                      {paused || item.enabled === false ? (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busyHere}
                          onClick={() =>
                            updateOne(item.id, { enabled: true, clear_pause: true })
                          }
                        >
                          Включить
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="secondary"
                            disabled={busyHere}
                            onClick={() => pauseWeek(item.id)}
                          >
                            Пауза неделя
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={busyHere}
                            onClick={() => updateOne(item.id, { enabled: false })}
                          >
                            Выключить
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="secondary danger-muted"
                        disabled={busyHere}
                        onClick={() => deleteOne(item.id)}
                      >
                        Удалить
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
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
  const [check, setCheck] = useState(null);
  const [checkLoading, setCheckLoading] = useState(true);
  const logScrollRef = useRef(null);

  const displayLog =
    (log?.running ? '[running]\n' : '') + (log?.content || 'No update log yet.');

  async function refreshLog() {
    setLog(await api.get('/api/actions/update-log'));
  }

  async function refreshCheck() {
    setCheckLoading(true);
    try {
      setCheck(await api.get('/api/actions/update-check'));
    } catch (e) {
      setCheck({
        ok: false,
        recommendUpdate: false,
        error: e && e.message ? e.message : String(e),
      });
    } finally {
      setCheckLoading(false);
    }
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
    refreshCheck();
  }, []);

  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [displayLog]);

  function renderUpdateBanner() {
    if (checkLoading) {
      return (
        <div className="update-check-banner update-check-banner--ok">
          <strong>Проверка git…</strong>
          <span className="muted">Сравниваем с origin (может занять до минуты без сети).</span>
        </div>
      );
    }
    if (!check || check.isGit === false || check.ok === false) {
      return (
        <div className="update-check-banner update-check-banner--warn">
          <strong>Обновления не проверены</strong>
          <span>{check?.error || 'Нет данных.'}</span>
          <p className="update-check-meta">
            На телефоне нужны установленные git и клон репозитория; кнопка «Обновить» ниже всё равно выполнит git pull.
          </p>
        </div>
      );
    }
    const behind = check.behind;
    const ahead = check.ahead;
    const rec = check.recommendUpdate;
    if (rec && typeof behind === 'number' && behind > 0) {
      return (
        <div className="update-check-banner update-check-banner--updates">
          <strong>Доступно обновление агента</strong>
          <span>
            На удалённой ветке на <strong>{behind}</strong>{' '}
            {behind === 1 ? 'коммит новее' : 'коммита новее'}, чем у тебя локально.
            {typeof ahead === 'number' && ahead > 0
              ? ` У тебя локально на ${ahead} комм. впереди origin — перед обновлением может понадобиться merge/rebase.`
              : ''}
          </span>
          <p className="update-check-meta">
            Ветка: <code>{check.branch || '—'}</code>
            {check.compareRef ? (
              <>
                {' · '}
                сравнение с <code>{check.upstream || check.compareRef}</code>
              </>
            ) : null}
            {check.fetchError ? ` · fetch: ${check.fetchError}` : ''}
          </p>
        </div>
      );
    }
    if (typeof behind === 'number' && typeof ahead === 'number' && behind === 0) {
      return (
        <div className="update-check-banner update-check-banner--ok">
          <strong>Версия актуальна</strong>
          <span>
            Локальная ветка совпадает с удалённой (0 новых коммитов на origin).
            {ahead > 0 ? ` Локально впереди на ${ahead} комм.` : ''}
          </span>
          <p className="update-check-meta">
            Ветка: <code>{check.branch || '—'}</code>
            {check.fetchError ? ` · fetch: ${check.fetchError}` : ''}
          </p>
        </div>
      );
    }
    return (
      <div className="update-check-banner update-check-banner--warn">
        <strong>Статус сравнения неясен</strong>
        <span>{check.error || check.fetchError || 'Нет upstream или не удалось посчитать коммиты.'}</span>
      </div>
    );
  }

  return (
    <div className="stack update-page">
      {renderUpdateBanner()}
      <div className="card">
        <h2>Update & restart agent</h2>
        <p className="muted">
          Runs git pull, npm install, doctor, then restarts bot and web tmux sessions.
          The page may disconnect for a few seconds.
        </p>
        <div className="actions">
          <button className="danger" onClick={triggerUpdate}>Update & restart</button>
          <button className="secondary" onClick={refreshLog}>Refresh log</button>
          <button type="button" className="secondary" onClick={() => { refreshCheck(); refreshLog(); }}>
            Проверить обновления
          </button>
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
        <div className="side-body">
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
        </div>
        <SideStatusFooter api={api} />
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
