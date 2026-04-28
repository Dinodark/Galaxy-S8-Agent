import { useCallback, useEffect, useMemo, useState } from 'react';

export const BASE_TOKENS = {
  '--color-bg': '#111111',
  '--color-surface': '#171717',
  '--color-surface-soft': '#1d1d1d',
  '--color-surface-hover': '#242424',
  '--color-text': '#f1f1f1',
  '--color-muted': '#9a9a9a',
  '--color-subtle': '#6f6f6f',
  '--color-accent': '#d6d6d6',
  '--color-glow': '#333333',
  '--color-user-mark': '#3a6ea8',
  '--color-agent-mark': '#8b4db0',
  '--color-danger-bg': '#2a171a',
  '--color-danger-text': '#f0c8cf',
  '--font-family-base': 'system-ui, -apple-system, Segoe UI, sans-serif',
  '--font-size-body': '14px',
  '--font-size-small': '12px',
  '--font-size-h1': '17px',
  '--font-size-h2': '18px',
  '--line-height-body': '1.45',
  '--space-1': '8px',
  '--space-2': '12px',
  '--space-3': '16px',
  '--space-4': '24px',
  '--radius-sm': '8px',
  '--radius-md': '12px',
  '--radius-lg': '18px',
  '--scrollbar-size': '9px',
  '--button-padding-y': '10px',
  '--button-padding-x': '12px',
  '--button-radius': '12px',
  '--tab-padding-y': '8px',
  '--tab-padding-x': '14px',
  '--tab-radius': '12px',
  '--card-padding': '14px',
  '--input-padding-y': '8px',
  '--input-padding-x': '10px',
  '--input-radius': '12px',
};

export const TOKEN_GROUPS = [
  {
    id: 'colors',
    title: 'Цвета',
    items: [
      ['--color-bg', 'Фон', 'color'],
      ['--color-surface', 'Панель', 'color'],
      ['--color-surface-soft', 'Карточки', 'color'],
      ['--color-surface-hover', 'Hover', 'color'],
      ['--color-text', 'Текст', 'color'],
      ['--color-muted', 'Вторичный текст', 'color'],
      ['--color-subtle', 'Тонкий текст', 'color'],
      ['--color-accent', 'Акцент', 'color'],
      ['--color-glow', 'Свечение', 'color'],
      ['--color-user-mark', 'Метка пользователя', 'color'],
      ['--color-agent-mark', 'Метка агента', 'color'],
      ['--color-danger-bg', 'Danger фон', 'color'],
      ['--color-danger-text', 'Danger текст', 'color'],
    ],
  },
  {
    id: 'typography',
    title: 'Типографика',
    items: [
      ['--font-family-base', 'Основной шрифт', 'text'],
      ['--font-size-body', 'Размер body', 'text'],
      ['--font-size-small', 'Размер small', 'text'],
      ['--font-size-h1', 'Размер h1', 'text'],
      ['--font-size-h2', 'Размер h2', 'text'],
      ['--line-height-body', 'Line-height body', 'text'],
    ],
  },
  {
    id: 'spacing',
    title: 'Отступы и радиусы',
    items: [
      ['--space-1', 'Space 1', 'text'],
      ['--space-2', 'Space 2', 'text'],
      ['--space-3', 'Space 3', 'text'],
      ['--space-4', 'Space 4', 'text'],
      ['--radius-sm', 'Radius sm', 'text'],
      ['--radius-md', 'Radius md', 'text'],
      ['--radius-lg', 'Radius lg', 'text'],
    ],
  },
  {
    id: 'components',
    title: 'Компоненты и скролл',
    items: [
      ['--scrollbar-size', 'Ширина скролла', 'text'],
      ['--button-padding-y', 'Button py', 'text'],
      ['--button-padding-x', 'Button px', 'text'],
      ['--button-radius', 'Button radius', 'text'],
      ['--tab-padding-y', 'Tab py', 'text'],
      ['--tab-padding-x', 'Tab px', 'text'],
      ['--tab-radius', 'Tab radius', 'text'],
      ['--card-padding', 'Card padding', 'text'],
      ['--input-padding-y', 'Input py', 'text'],
      ['--input-padding-x', 'Input px', 'text'],
      ['--input-radius', 'Input radius', 'text'],
    ],
  },
];

export function mergeTokens(tokens) {
  return { ...BASE_TOKENS, ...(tokens || {}) };
}

export function applyDesignTokens(tokens) {
  const merged = mergeTokens(tokens);
  for (const [key, value] of Object.entries(merged)) {
    document.documentElement.style.setProperty(key, value);
  }
}

export function useDesignSystem(api) {
  const [state, setState] = useState({
    loading: true,
    error: '',
    activePresetId: 'base',
    activeTokens: mergeTokens({}),
    presets: [],
  });

  const applyFromResponse = useCallback((data) => {
    const activeTokens = mergeTokens(data && data.activeTokens);
    applyDesignTokens(activeTokens);
    setState({
      loading: false,
      error: '',
      activePresetId: String((data && data.activePresetId) || 'base'),
      activeTokens,
      presets: Array.isArray(data && data.presets) ? data.presets : [],
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/design');
      applyFromResponse(data);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err.message || String(err),
      }));
      applyDesignTokens(BASE_TOKENS);
    }
  }, [api, applyFromResponse]);

  useEffect(() => {
    load();
  }, [load]);

  const savePreset = useCallback(
    async ({ id, name, tokens }) => {
      const body = { name, tokens };
      if (id) body.id = id;
      const data = await api.post('/api/design/preset/save', body);
      applyFromResponse(data);
      return data;
    },
    [api, applyFromResponse]
  );

  const activatePreset = useCallback(
    async (id) => {
      const data = await api.post('/api/design/activate', { id });
      applyFromResponse(data);
      return data;
    },
    [api, applyFromResponse]
  );

  const deletePreset = useCallback(
    async (id) => {
      const data = await api.post('/api/design/preset/delete', { id });
      applyFromResponse(data);
      return data;
    },
    [api, applyFromResponse]
  );

  const resetBase = useCallback(async () => {
    const data = await api.post('/api/design/reset-base', {});
    applyFromResponse(data);
    return data;
  }, [api, applyFromResponse]);

  const value = useMemo(
    () => ({
      ...state,
      load,
      savePreset,
      activatePreset,
      deletePreset,
      resetBase,
      applyPreview: (tokens) => applyDesignTokens(tokens),
      restoreActive: () => applyDesignTokens(state.activeTokens),
    }),
    [state, load, savePreset, activatePreset, deletePreset, resetBase]
  );

  return value;
}
