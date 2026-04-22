const memoryTools = require('./memory');
const phoneTools = require('./phone');
const shellTools = require('./shell');
const fileTools = require('./files');

const registry = {
  ...memoryTools,
  ...phoneTools,
  ...shellTools,
  ...fileTools,
};

function listSchemas() {
  return Object.values(registry).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

async function execute(name, args) {
  const tool = registry[name];
  if (!tool) {
    return { ok: false, error: `Unknown tool: ${name}` };
  }
  try {
    const result = await tool.handler(args || {});
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = { listSchemas, execute, registry };
