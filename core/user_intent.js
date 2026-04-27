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
  const asksWrite = userAskedToWriteMemory(s);
  const asksInventory =
    /какие|какой|какая|какое|список|покажи|показать|структур|дерев|что\s+есть|где\s+файл|какие\s+файл|memory|notes|list|что\s+в\s+базе/.test(s) &&
    /файл|замет|баз[ауы]\s+знан|memory|notes/.test(s);
  return asksInventory && !asksWrite;
}

function userAskedForReminder(text) {
  return /\bremind\b|напомни|напомин/i.test(String(text || ''));
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
  userAskedForReminder,
  shouldUseDeterministicMemoryInventory,
};
