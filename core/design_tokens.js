const SCHEMA_VERSION = 1;

const BASE_TOKENS = {
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

const TOKEN_KEYS = Object.keys(BASE_TOKENS);

module.exports = {
  SCHEMA_VERSION,
  BASE_TOKENS,
  TOKEN_KEYS,
};
