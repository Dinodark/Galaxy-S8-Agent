const test = require('node:test');
const assert = require('node:assert/strict');
const fse = require('fs-extra');

const design = require('../core/design_system');

async function withIsolatedStore(run) {
  const file = design.STORE_FILE;
  const backup = `${file}.bak-test`;
  const exists = await fse.pathExists(file);
  if (exists) await fse.move(file, backup, { overwrite: true });
  try {
    await design.reload();
    return await run();
  } finally {
    await design.reload();
    await fse.remove(file).catch(() => {});
    if (await fse.pathExists(backup)) {
      await fse.move(backup, file, { overwrite: true });
    }
    await design.reload();
  }
}

test('design: returns base preset for new user', async () => {
  await withIsolatedStore(async () => {
    const res = await design.getDesign(1001);
    assert.equal(res.activePresetId, 'base');
    assert.equal(Array.isArray(res.presets), true);
    assert.equal(res.presets.length, 1);
    assert.equal(res.presets[0].id, 'base');
    assert.equal(res.presets[0].locked, true);
    assert.equal(res.activeTokens['--color-bg'], '#111111');
  });
});

test('design: user presets isolated by chatId', async () => {
  await withIsolatedStore(async () => {
    const u1 = await design.savePreset(1001, {
      name: 'U1',
      tokens: { '--color-bg': '#000000' },
    });
    const created = u1.presets.find((p) => p.name === 'U1');
    assert.ok(created);

    const u2 = await design.getDesign(2002);
    assert.equal(u2.presets.some((p) => p.name === 'U1'), false);
    assert.equal(u2.activePresetId, 'base');
  });
});

test('design: activate and delete preset', async () => {
  await withIsolatedStore(async () => {
    const afterSave = await design.savePreset(1001, {
      name: 'Dark Plus',
      tokens: { '--color-bg': '#0a0a0a' },
    });
    const p = afterSave.presets.find((x) => x.name === 'Dark Plus');
    assert.ok(p);

    const afterActivate = await design.activatePreset(1001, p.id);
    assert.equal(afterActivate.activePresetId, p.id);
    assert.equal(afterActivate.activeTokens['--color-bg'], '#0a0a0a');

    const afterDelete = await design.deletePreset(1001, p.id);
    assert.equal(afterDelete.activePresetId, 'base');
    assert.equal(afterDelete.presets.some((x) => x.id === p.id), false);
  });
});
