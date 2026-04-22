const config = require('../../config');
const { registry } = require('../tools');

async function readBattery() {
  const tool = registry.phone_battery;
  if (!tool) throw new Error('phone_battery tool not registered');
  return tool.handler({});
}

function isChargingStatus(s) {
  const v = String(s || '').toUpperCase();
  return v === 'CHARGING' || v === 'FULL';
}

function startBatteryWatcher({ onLowBattery, log = console }) {
  const cfg = config.battery;
  if (!cfg.enabled) {
    log.log('[watcher:battery] disabled via BATTERY_WATCH_ENABLED=false');
    return () => {};
  }

  let alerted = false;
  let timer = null;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    let r;
    try {
      r = await readBattery();
    } catch (err) {
      if (err && err.code === 'NO_TERMUX') {
        stopped = true;
        if (timer) clearInterval(timer);
        log.warn(
          '[watcher:battery] disabled: termux-api not available on this host'
        );
        return;
      }
      log.warn('[watcher:battery] read error:', err.message);
      return;
    }

    const pct = Number(r && r.percentage);
    if (!Number.isFinite(pct)) {
      log.warn('[watcher:battery] unexpected payload:', JSON.stringify(r));
      return;
    }

    const charging = isChargingStatus(r.status);

    if (pct <= cfg.lowThreshold && !charging) {
      if (!alerted) {
        alerted = true;
        try {
          await onLowBattery({ percentage: pct, status: r.status, raw: r });
        } catch (err) {
          log.warn('[watcher:battery] alert handler error:', err.message);
        }
      }
    } else if (charging || pct >= cfg.lowThreshold + cfg.hysteresis) {
      alerted = false;
    }
  }

  tick();
  timer = setInterval(tick, cfg.pollIntervalMs);
  log.log(
    `[watcher:battery] started (threshold=${cfg.lowThreshold}%, every ${
      cfg.pollIntervalMs / 1000
    }s)`
  );

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}

module.exports = { startBatteryWatcher };
