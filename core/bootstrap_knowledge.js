const path = require('path');
const fse = require('fs-extra');
const config = require('../config');

const TEMPLATE = path.join(__dirname, 'templates', 'knowledge', 'projects_index.md');

const FALLBACK = `# Маршруты знаний (orchestrator)

# Этот файл — ядро маршрутизации: правит только владелец. Агент в него не пишет.

# Формат: путь/к/файлу.md | ключ1, ключ2, домен.ru

projects/inbox.md | инбокс, сортировка, needs_routing
`;

/**
 * Создаёт memory/notes/projects/ и, при отсутствии, копирует projects/_index.md из шаблона.
 * @returns {Promise<{ createdIndex: boolean, path: string }>}
 */
async function ensureKnowledgeTree() {
  const projectsDir = path.join(config.paths.notesDir, 'projects');
  await fse.ensureDir(projectsDir);
  const target = path.join(projectsDir, '_index.md');
  if (await fse.pathExists(target)) {
    return { createdIndex: false, path: target };
  }
  const body = (await fse.pathExists(TEMPLATE))
    ? await fse.readFile(TEMPLATE, 'utf8')
    : FALLBACK;
  await fse.writeFile(target, body, 'utf8');
  return { createdIndex: true, path: target };
}

module.exports = { ensureKnowledgeTree, TEMPLATE };
