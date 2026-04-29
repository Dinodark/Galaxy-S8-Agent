/**
 * Detects whether the user wants to persist information into long-term memory (notes / KB).
 * Keep in sync with core/prompts/system.md (write/save path).
 * Broad enough for Russian phrasing; "внести" etc. are common when TG splits the saving verb into the first block only.
 */
function userAskedToWriteMemory(text) {
  const s = String(text || '').toLowerCase();
  return /созда(й|ть)|запиши|сохрани(ть)?|добав(ь|ить)|добав(ь|ить)\s+в\s+замет|добав(ь|ить)\s+в\s+памят|добав(ь|ить)\s+в\s+базу|внеси|внести(\s+в)?|занеси|занести|разнеси|заполни|сформируй|сформировать|сделай|создай\s+файл|создай\s+структур|внеси\s+туда|сохрани\s+это|запомни\s+это|нужно\s+сохранить|нужно\s+внести|нужно\s+запомнить|нужна\s+замет|надо\s+сохранить|надо\s+запомнить|занес(и|ти)\s+в\s+базу|зафиксируй|зафиксировать|оформ(и|ить)\s+замет/i.test(
    s
  );
}

function userAskedForMemoryInventory(text) {
  const s = String(text || '').toLowerCase();
  if (userAskedToWriteMemory(s)) return false;

  /** User wants a list / tree / inventory of notes (not a write). */
  const wantsListing =
    /какие|какой|какая|какое|перечисл|список|покажи|показать|структур|дерев|что\s+есть|где\s+файл|какие\s+файл|memory|notes|\blist\b|что\s+в\s+базе|полн(ого|ый|ая|ое)?\s*список|все\s+файл|файлов(ая|ую|ой)?\s*структур|каталог|memory\/notes|наблюд|контрол|проверь|просмотр|имеющ|находится\s+в\s+базе/.test(
      s
    );

  /**
   * Second leg: must relate to files / KB / tree. Includes "полный список" without the word "файл"
   * (that case used to fail the old two-regex AND).
   */
  /** «в работе», «работаем» — активные задачи без слова «проект» (поймает и типовые формулировки с опечатками в слове «проекты»). */
  const aboutFilesOrKb =
    /файл|замет|баз[ауы]\s+знан|memory|notes|memory\/notes|полн(ого|ый|ая|ое)?\s*список|список\s+файл|все\s+файл|файлов(ая|ую|ой)?\s*структур|каталог|дерев|папк|структур|проект|инбокс|сводк|работе|работаем/i.test(
      s
    );

  return wantsListing && aboutFilesOrKb;
}

/**
 * Вопросы «над чем работаем», «что в базе» — нужен ответ модели с контекстом, а не только дерево файлов.
 */
function userWantsKnowledgeDiscussion(text) {
  const s = String(text || '').toLowerCase();
  return /проект|над\s+чем\s+(мы\s+|вы\s+|я\s+)?работ|работе|работаем|в\s+работе\s+сейчас|активн\w*\s+проект|баз[ау]\s+знан|что\s+(ты\s+|вы\s+)?(помнишь|знаешь)\s+про|обсудим|инбокс|какие\s+у\s+нас|скажи.{0,40}какие/i.test(
    s
  );
}

function userAskedForReminder(text) {
  const s = String(text || '');
  if (/\bremind\b|напомни|напомин|не\s+забудь/i.test(s)) return true;
  /** Follow-up later without the word «напомни» (recovery path + model hint). */
  return /через\s+\d+\s+(день|дня|дней)[^.!?]{0,80}(уточнить|проверить|спросить|написать|напомнить\s+себе)/i.test(
    s
  );
}

/**
 * Voice/audio/video notes are usually substantive dumps; treat long ones as save-worthy
 * so orchestrator + inbox fallback run without explicit «запомни».
 */
function implicitCaptureFromMedia(via, text) {
  const v = String(via || 'text');
  if (!/^(voice|audio|video_note)$/.test(v)) return false;
  if (userAskedForMemoryInventory(text)) return false;
  const s = String(text || '');
  if (s.length < 80) return false;
  return true;
}

/**
 * True only for short, inventory-style turns. Long or multi-paragraph text may mix
 * "what files exist" with pasted content; those must go through the model (and write path).
 */
function shouldUseDeterministicMemoryInventory(userMessage) {
  if (!userAskedForMemoryInventory(userMessage)) return false;
  const s = String(userMessage);
  if (s.length > 4000) return false;
  if (s.length > 800 && (s.match(/\n{2,}/g) || []).length >= 2) return false;
  return true;
}

module.exports = {
  userAskedToWriteMemory,
  userAskedForMemoryInventory,
  userWantsKnowledgeDiscussion,
  userAskedForReminder,
  implicitCaptureFromMedia,
  shouldUseDeterministicMemoryInventory,
};
