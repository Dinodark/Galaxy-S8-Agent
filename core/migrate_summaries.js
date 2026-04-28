'use strict';

const path = require('path');
const fse = require('fs-extra');
const config = require('../config');
const { SUMMARIES_DIR, isSummaryFilename } = require('./notes_paths');

function migratableLegacyName(name) {
  return typeof name === 'string' && isSummaryFilename(name);
}

/** Переносит summary-YYYY-MM-DD.md из корня memory/notes в memory/notes/summaries/ */
async function migrateLegacySummariesToSummariesDir(log = console) {
  const root = config.paths.notesDir;
  await fse.ensureDir(root);
  const destDir = path.join(root, SUMMARIES_DIR);
  await fse.ensureDir(destDir);

  let names;
  try {
    names = await fse.readdir(root);
  } catch {
    return { moved: [] };
  }

  const moved = [];
  for (const name of names) {
    if (!migratableLegacyName(name)) continue;
    const src = path.join(root, name);
    const st = await fse.stat(src).catch(() => null);
    if (!st || !st.isFile()) continue;
    const dest = path.join(destDir, name);
    if (await fse.pathExists(dest)) continue;
    try {
      await fse.move(src, dest);
      moved.push(path.posix.join(SUMMARIES_DIR, name));
    } catch (e) {
      log.warn('[migrate_summaries]', name, e.message);
    }
  }
  return { moved };
}

module.exports = { migrateLegacySummariesToSummariesDir };
