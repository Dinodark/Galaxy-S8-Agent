'use strict';

const assert = require('assert');
const { isSummaryFilename, summariesRelForDay } = require('../core/notes_paths');

assert.strictEqual(isSummaryFilename('summary-2026-04-28.md'), true);
assert.strictEqual(isSummaryFilename('summaries/summary-2026-04-28.md'), true);
assert.strictEqual(isSummaryFilename('foo.md'), false);
assert.strictEqual(summariesRelForDay('2026-05-01'), 'summaries/summary-2026-05-01.md');

console.log('notes_paths OK');
