const path = require('path');
const crypto = require('crypto');
const fse = require('fs-extra');
const config = require('../config');
const { SCHEMA_VERSION, BASE_TOKENS, TOKEN_KEYS } = require('./design_tokens');

const STORE_FILE = path.join(config.paths.memoryDir, 'design_presets.json');

let cache = null;
let saveChain = Promise.resolve();

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeTokenValue(value) {
  return String(value == null ? '' : value).trim();
}

function sanitizeTokens(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of TOKEN_KEYS) {
    const candidate = Object.prototype.hasOwnProperty.call(src, key)
      ? src[key]
      : BASE_TOKENS[key];
    const normalized = normalizeTokenValue(candidate);
    out[key] = normalized || BASE_TOKENS[key];
  }
  return out;
}

function basePreset() {
  const ts = nowIso();
  return {
    id: 'base',
    name: 'Base',
    locked: true,
    createdAt: ts,
    updatedAt: ts,
    tokens: clone(BASE_TOKENS),
  };
}

function makeStore() {
  return {
    schemaVersion: SCHEMA_VERSION,
    users: {},
  };
}

function makeUserProfile() {
  return {
    activePresetId: 'base',
    presets: [basePreset()],
  };
}

function ensureUserProfile(store, userId) {
  if (!store.users[userId]) store.users[userId] = makeUserProfile();
  const profile = store.users[userId];
  if (!Array.isArray(profile.presets) || profile.presets.length === 0) {
    profile.presets = [basePreset()];
  }
  if (!profile.presets.some((p) => p.id === 'base')) {
    profile.presets.unshift(basePreset());
  }
  profile.presets = profile.presets.map((preset) => ({
    id: String(preset.id || ''),
    name: String(preset.name || '').trim() || 'Preset',
    locked: preset.id === 'base' ? true : preset.locked === true,
    createdAt: preset.createdAt || nowIso(),
    updatedAt: preset.updatedAt || nowIso(),
    tokens: sanitizeTokens(preset.tokens),
  }));
  if (!profile.activePresetId || !profile.presets.some((p) => p.id === profile.activePresetId)) {
    profile.activePresetId = 'base';
  }
  return profile;
}

async function loadStore() {
  if (cache) return cache;
  if (!(await fse.pathExists(STORE_FILE))) {
    cache = makeStore();
    return cache;
  }
  try {
    const raw = await fse.readJson(STORE_FILE);
    cache = raw && typeof raw === 'object' ? raw : makeStore();
  } catch {
    cache = makeStore();
  }
  if (!cache.schemaVersion) cache.schemaVersion = SCHEMA_VERSION;
  if (!cache.users || typeof cache.users !== 'object') cache.users = {};
  return cache;
}

function persistStore() {
  saveChain = saveChain.then(async () => {
    await fse.ensureDir(path.dirname(STORE_FILE));
    await fse.writeJson(STORE_FILE, cache || makeStore(), { spaces: 2 });
  });
  return saveChain;
}

function randomId() {
  return crypto.randomBytes(6).toString('base64url').toLowerCase();
}

function sanitizeName(name) {
  const n = String(name || '').trim();
  if (!n) throw new Error('preset name cannot be empty');
  if (n.length > 64) throw new Error('preset name must be <= 64 chars');
  return n;
}

function profileResponse(profile) {
  const active = profile.presets.find((p) => p.id === profile.activePresetId) || profile.presets[0];
  return {
    schemaVersion: SCHEMA_VERSION,
    activePresetId: active.id,
    activeTokens: clone(active.tokens),
    presets: profile.presets.map((p) => ({
      id: p.id,
      name: p.name,
      locked: !!p.locked,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      tokens: clone(p.tokens),
    })),
  };
}

async function getDesign(userId) {
  const key = String(userId || 'owner');
  const store = await loadStore();
  const profile = ensureUserProfile(store, key);
  cache = store;
  return profileResponse(profile);
}

async function savePreset(userId, payload) {
  const key = String(userId || 'owner');
  const store = await loadStore();
  const profile = ensureUserProfile(store, key);
  const id = String((payload && payload.id) || '').trim();
  const name = sanitizeName(payload && payload.name);
  const tokens = sanitizeTokens(payload && payload.tokens);
  const ts = nowIso();

  let preset = null;
  if (id) {
    preset = profile.presets.find((p) => p.id === id);
  }
  if (preset && preset.locked) {
    throw new Error('base preset is read-only; save as new preset');
  }
  if (preset) {
    preset.name = name;
    preset.tokens = tokens;
    preset.updatedAt = ts;
  } else {
    const newId = `preset_${randomId()}`;
    preset = {
      id: newId,
      name,
      locked: false,
      createdAt: ts,
      updatedAt: ts,
      tokens,
    };
    profile.presets.push(preset);
  }
  profile.activePresetId = preset.id;
  cache = store;
  await persistStore();
  return profileResponse(profile);
}

async function activatePreset(userId, presetId) {
  const key = String(userId || 'owner');
  const wanted = String(presetId || '').trim();
  if (!wanted) throw new Error('preset id is required');
  const store = await loadStore();
  const profile = ensureUserProfile(store, key);
  const found = profile.presets.find((p) => p.id === wanted);
  if (!found) throw new Error('preset not found');
  profile.activePresetId = found.id;
  cache = store;
  await persistStore();
  return profileResponse(profile);
}

async function deletePreset(userId, presetId) {
  const key = String(userId || 'owner');
  const wanted = String(presetId || '').trim();
  if (!wanted) throw new Error('preset id is required');
  if (wanted === 'base') throw new Error('base preset cannot be deleted');
  const store = await loadStore();
  const profile = ensureUserProfile(store, key);
  const before = profile.presets.length;
  profile.presets = profile.presets.filter((p) => p.id !== wanted);
  if (profile.presets.length === before) throw new Error('preset not found');
  if (profile.activePresetId === wanted) profile.activePresetId = 'base';
  cache = store;
  await persistStore();
  return profileResponse(profile);
}

async function resetBase(userId) {
  return activatePreset(userId, 'base');
}

async function reload() {
  cache = null;
  return cache;
}

module.exports = {
  STORE_FILE,
  SCHEMA_VERSION,
  BASE_TOKENS,
  TOKEN_KEYS,
  getDesign,
  savePreset,
  activatePreset,
  deletePreset,
  resetBase,
  reload,
  sanitizeTokens,
};
