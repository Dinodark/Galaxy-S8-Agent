/**
 * Сравнение локальной ветки с origin для страницы Update (git fetch + счётчик коммитов).
 */
'use strict';

const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileP = promisify(execFile);
const REPO_ROOT = path.join(__dirname, '..');

async function runGit(args, { timeoutMs = 90_000 } = {}) {
  return execFileP('git', args, {
    cwd: REPO_ROOT,
    maxBuffer: 2_000_000,
    timeout: timeoutMs,
    encoding: 'utf8',
  });
}

/**
 * @returns {Promise<{
 *   ok: boolean,
 *   isGit: boolean,
 *   branch: string | null,
 *   upstream: string | null,
 *   compareRef: string | null,
 *   behind: number | null,
 *   ahead: number | null,
 *   fetchOk: boolean,
 *   fetchError: string | null,
 *   error: string | null,
 *   recommendUpdate: boolean
 * }>}
 */
async function getUpdateStatus() {
  const out = {
    ok: true,
    isGit: false,
    branch: null,
    upstream: null,
    compareRef: null,
    behind: null,
    ahead: null,
    fetchOk: false,
    fetchError: null,
    error: null,
    recommendUpdate: false,
  };

  let inside;
  try {
    const r = await runGit(['rev-parse', '--is-inside-work-tree'], { timeoutMs: 5_000 });
    inside = String(r.stdout).trim() === 'true';
  } catch (e) {
    return {
      ...out,
      ok: false,
      isGit: false,
      error: e && e.message ? e.message : 'git недоступен',
    };
  }

  if (!inside) {
    return { ...out, ok: false, isGit: false, error: 'Каталог не git-репозиторий' };
  }
  out.isGit = true;

  let branch;
  try {
    const r = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 5_000 });
    branch = String(r.stdout).trim();
    if (branch === 'HEAD') {
      return { ...out, ok: false, error: 'detached HEAD — сравнение с origin пропущено' };
    }
  } catch (e) {
    return { ...out, ok: false, error: e && e.message ? e.message : 'не удалось прочитать ветку' };
  }
  out.branch = branch;

  const skipFetch = process.env.GALAXY_UPDATE_CHECK_FETCH === '0';
  if (!skipFetch) {
    try {
      await runGit(['fetch', '--prune', 'origin'], { timeoutMs: 90_000 });
      out.fetchOk = true;
    } catch (e) {
      out.fetchError = e && e.message ? e.message : String(e);
    }
  } else {
    out.fetchOk = true;
    out.fetchError = 'fetch отключён (GALAXY_UPDATE_CHECK_FETCH=0)';
  }

  let compareRef = null;
  let upstream = null;
  try {
    const r = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
      timeoutMs: 8_000,
    });
    upstream = String(r.stdout).trim();
    compareRef = '@{u}';
  } catch {
    const remoteRef = `refs/remotes/origin/${branch}`;
    try {
      await runGit(['rev-parse', '--verify', remoteRef], { timeoutMs: 5_000 });
      compareRef = remoteRef;
    } catch {
      compareRef = null;
    }
  }

  out.upstream = upstream;
  out.compareRef = compareRef;

  if (!compareRef) {
    out.behind = null;
    out.ahead = null;
    return out;
  }

  try {
    const behindRange =
      compareRef === '@{u}' ? 'HEAD..@{u}' : `HEAD..${compareRef}`;
    const aheadRange =
      compareRef === '@{u}' ? '@{u}..HEAD' : `${compareRef}..HEAD`;

    const [behRes, ahRes] = await Promise.all([
      runGit(['rev-list', '--count', behindRange], { timeoutMs: 15_000 }),
      runGit(['rev-list', '--count', aheadRange], { timeoutMs: 15_000 }),
    ]);

    out.behind = parseInt(String(behRes.stdout).trim(), 10);
    out.ahead = parseInt(String(ahRes.stdout).trim(), 10);
    if (!Number.isFinite(out.behind)) out.behind = 0;
    if (!Number.isFinite(out.ahead)) out.ahead = 0;
    out.recommendUpdate = out.behind > 0;
  } catch (e) {
    out.error = e && e.message ? e.message : 'не удалось сравнить с удалённой веткой';
    out.behind = null;
    out.ahead = null;
  }

  return out;
}

module.exports = { getUpdateStatus, REPO_ROOT };
