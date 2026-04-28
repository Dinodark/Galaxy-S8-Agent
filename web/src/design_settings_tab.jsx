import React, { useEffect, useMemo, useState } from 'react';
import { TOKEN_GROUPS, mergeTokens } from './design_system.js';

function TokenField({ token, label, type, value, onChange }) {
  if (type === 'color') {
    return (
      <label className="color-field" key={token}>
        <span>{label}</span>
        <input type="color" value={value} onChange={(e) => onChange(token, e.target.value)} />
        <code>{value}</code>
      </label>
    );
  }
  return (
    <label className="color-field" key={token}>
      <span>{label}</span>
      <input
        className="settings-input"
        type="text"
        value={value}
        onChange={(e) => onChange(token, e.target.value)}
      />
      <code>{value}</code>
    </label>
  );
}

export function DesignSettingsTab({ design }) {
  const [draft, setDraft] = useState(mergeTokens(design && design.activeTokens));
  const [presetName, setPresetName] = useState('');
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);

  const activePreset = useMemo(() => {
    if (!design) return null;
    return (design.presets || []).find((p) => p.id === design.activePresetId) || null;
  }, [design]);

  useEffect(() => {
    setDraft(mergeTokens(design && design.activeTokens));
    if (activePreset) setPresetName(activePreset.name || '');
  }, [design && design.activeTokens, activePreset && activePreset.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (design && design.applyPreview) design.applyPreview(draft);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateToken(token, value) {
    setDraft((cur) => ({ ...cur, [token]: value }));
  }

  async function saveAsNew() {
    setSaveError('');
    setBusy(true);
    try {
      const name = presetName.trim() || `Preset ${((design && design.presets) || []).length + 1}`;
      await design.savePreset({ name, tokens: draft });
    } catch (err) {
      setSaveError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveActive() {
    if (!activePreset || activePreset.locked) return saveAsNew();
    setSaveError('');
    setBusy(true);
    try {
      await design.savePreset({
        id: activePreset.id,
        name: presetName.trim() || activePreset.name,
        tokens: draft,
      });
    } catch (err) {
      setSaveError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function activate(id) {
    setSaveError('');
    setBusy(true);
    try {
      await design.activatePreset(id);
    } catch (err) {
      setSaveError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removePreset(id) {
    setSaveError('');
    setBusy(true);
    try {
      await design.deletePreset(id);
    } catch (err) {
      setSaveError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetBase() {
    setSaveError('');
    setBusy(true);
    try {
      await design.resetBase();
    } catch (err) {
      setSaveError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!design || design.loading) {
    return (
      <section className="card settings-card">
        <h2>Дизайн</h2>
        <p className="muted">Загрузка профиля темы…</p>
      </section>
    );
  }

  if (design.error) {
    return (
      <section className="card settings-card">
        <h2>Дизайн</h2>
        <p className="journal-ingest-msg err">{design.error}</p>
      </section>
    );
  }

  return (
    <section className="card settings-card">
      <h2>Дизайн</h2>
      <p className="muted settings-lead">
        Единая тема для всего интерфейса. Изменения применяются сразу и доступны на всех ваших устройствах.
      </p>

      {saveError && <p className="journal-ingest-msg err">{saveError}</p>}

      <div className="settings-inline settings-inline-grow">
        <input
          className="settings-input settings-input-wide"
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          placeholder="Название пресета"
        />
        <button type="button" className="secondary" disabled={busy} onClick={saveActive}>
          Сохранить активный
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={saveAsNew}>
          Сохранить как новый
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={resetBase}>
          Базовый preset
        </button>
      </div>

      <p className="muted mood-presets-hint">Ваши пресеты:</p>
      <div className="presets">
        {(design.presets || []).map((preset) => (
          <div className="preset-row" key={preset.id}>
            <button type="button" onClick={() => activate(preset.id)}>
              {preset.name}
              {preset.id === design.activePresetId ? ' (активный)' : ''}
            </button>
            <button
              type="button"
              disabled={!!preset.locked}
              onClick={() => removePreset(preset.id)}
              aria-label={'Удалить ' + preset.name}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {TOKEN_GROUPS.map((group) => (
        <div key={group.id} className="settings-battery-card">
          <h3 className="settings-subtitle">{group.title}</h3>
          <div className="palette-grid">
            {group.items.map(([token, label, type]) => (
              <TokenField
                key={token}
                token={token}
                label={label}
                type={type}
                value={draft[token]}
                onChange={updateToken}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
