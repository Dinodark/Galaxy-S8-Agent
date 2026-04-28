/**
 * Общая схема путей для вечерних сводок (daily review).
 * Рабочее расположение: memory/notes/summaries/summary-YYYY-MM-DD.md
 * Устаревший корень: memory/notes/summary-YYYY-MM-DD.md — мигрируются при старте веба.
 */
'use strict';

const path = require('path');

const SUMMARIES_DIR = 'summaries';
const SUMMARY_PREFIX = 'summary-';
const SUMMARY_SUFFIX = '.md';

/** Имя файла (или путь) — это файл сводки по паттерну даты? */
function isSummaryFilename(base) {
  const b = String(base || '').split(/[/\\]/).pop();
  return /^summary-\d{4}-\d{2}-\d{2}\.md$/i.test(b);
}

/** Относительный путь posix: summaries/summary-YYYY-MM-DD.md */
function summariesRelForDay(dayStr) {
  return path.posix.join(SUMMARIES_DIR, `${SUMMARY_PREFIX}${dayStr}${SUMMARY_SUFFIX}`);
}

/** Старый путь только имя файла в корне notes */
function legacySummaryRelForDay(dayStr) {
  return `${SUMMARY_PREFIX}${dayStr}${SUMMARY_SUFFIX}`;
}

module.exports = {
  SUMMARIES_DIR,
  SUMMARY_PREFIX,
  SUMMARY_SUFFIX,
  isSummaryFilename,
  summariesRelForDay,
  legacySummaryRelForDay,
};
