const config = require('../config');

function isAllowed(userId) {
  if (!config.telegram.allowedUserIds.length) return false;
  return config.telegram.allowedUserIds.includes(Number(userId));
}

module.exports = { isAllowed };
