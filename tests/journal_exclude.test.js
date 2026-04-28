const test = require('node:test');
const assert = require('node:assert/strict');
const fse = require('fs-extra');

const journal = require('../core/journal');

async function withDayFiles(chatId, day, run) {
  const file = journal.fileFor(chatId, day);
  const excl = journal.excludedFileFor(chatId, day);
  const fileBak = `${file}.bak-test`;
  const exclBak = `${excl}.bak-test`;
  if (await fse.pathExists(file)) await fse.move(file, fileBak, { overwrite: true });
  if (await fse.pathExists(excl)) await fse.move(excl, exclBak, { overwrite: true });
  try {
    await fse.ensureDir(journal.dirFor(chatId));
    return await run(file, excl);
  } finally {
    await fse.remove(file).catch(() => {});
    await fse.remove(excl).catch(() => {});
    if (await fse.pathExists(fileBak)) await fse.move(fileBak, file, { overwrite: true });
    if (await fse.pathExists(exclBak)) await fse.move(exclBak, excl, { overwrite: true });
  }
}

test('journal exclude hides entries from default readDay', async () => {
  const chatId = 999001;
  const day = '2026-04-28';
  await withDayFiles(chatId, day, async (file) => {
    const rows = [
      { id: 'a1', ts: new Date().toISOString(), source: 'user', via: 'text', text: 'one' },
      { id: 'a2', ts: new Date().toISOString(), source: 'assistant', via: 'text', text: 'two' },
    ];
    await fse.writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    await journal.setExcluded(chatId, day, 'a2', true);

    const filtered = await journal.readDay(chatId, day);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'a1');

    const all = await journal.readDay(chatId, day, { includeExcluded: true });
    assert.equal(all.length, 2);
    assert.equal(all.find((x) => x.id === 'a2').excluded, true);
  });
});

test('journal unexclude restores entry in readDay', async () => {
  const chatId = 999002;
  const day = '2026-04-28';
  await withDayFiles(chatId, day, async (file) => {
    const row = { id: 'b1', ts: new Date().toISOString(), source: 'user', via: 'text', text: 'x' };
    await fse.writeFile(file, JSON.stringify(row) + '\n', 'utf8');
    await journal.setExcluded(chatId, day, 'b1', true);
    await journal.setExcluded(chatId, day, 'b1', false);
    const filtered = await journal.readDay(chatId, day);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'b1');
    assert.equal(filtered[0].excluded, false);
  });
});
