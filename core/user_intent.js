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

/**
 * Левый край «слова» для кириллицы: \\b в JS не годится для русских букв.
 */
const CYR_TOKEN_L = '(?:^|[\\s—–,.;:!?\'"«„(-])';

function hasClassicReminderPhrase(t) {
  const s = String(t || '');
  if (/\bremind\b/i.test(s)) return true;
  if (new RegExp(`${CYR_TOKEN_L}не\\s+забудь`, 'i').test(s)) return true;
  if (new RegExp(`${CYR_TOKEN_L}напомни`, 'i').test(s)) return true;
  return /напоминай|напоминать|напоминание/i.test(s);
}

/** «по понедельникам», «каждый вторник», сокращения пн–вс, «по будням». */
function weekdayRecurrenceCue(text) {
  const t = String(text || '');
  const li = new RegExp(
    `${CYR_TOKEN_L}по\\s+(?:пн|вт|ср|чт|пт|сб|вс)(?=[\\s—–,.;:!?)\\]»]|$)`,
    'i'
  );
  if (li.test(t)) return true;
  if (
    new RegExp(
      `${CYR_TOKEN_L}по\\s+(?:понедельник|вторник|сред|четверг|пятниц|суббот|воскресен)[а-яё]*`,
      'i'
    ).test(t)
  ) {
    return true;
  }
  if (
    new RegExp(
      `(?:^|[\\s—–,.;:!?'"(«])кажды(?:й|е)\\s+(?:понедельник|вторник|сред|четверг|пятниц|суббот|воскресен)[а-яё]*`,
      'i'
    ).test(t)
  ) {
    return true;
  }
  if (
    new RegExp(`${CYR_TOKEN_L}по\\s+(?:будням|выходным)(?=[\\s—–,.;:!?)\\]»]|$)`, 'i').test(
      t
    )
  ) {
    return true;
  }
  return false;
}

/** Контент про календарь / расписание / повтор без явного «напомни». */
function calendarOrScheduleDomainCue(text) {
  const low = String(text || '').toLowerCase();
  return (
    /календар/.test(low) ||
    /расписан/.test(low) ||
    /регулярн/.test(low) ||
    /еженедельн/.test(low) ||
    /раз\s+в\s+неделю/.test(low)
  );
}

/** Глагол «записать расписание / создать слот», без привязки к заметкам KB. */
function calendarSchedulingVerbCue(text) {
  const t = String(text || '');
  if (hasClassicReminderPhrase(t)) return true;
  return (
    /добавь|добавить|создай|создать|поставь|поставить|запланируй|запланировать|назначь|назначить/i.test(
      t
    ) ||
    /внеси\s+в\s+календар|занеси\s+в\s+календар/i.test(t)
  );
}

/** Просмотр / вопрос про расписание — не путать с созданием напоминания. */
function looksLikeScheduleOrCalendarQuestion(text) {
  const low = String(text || '').toLowerCase();
  return (
    /что\s+(у\s+меня|есть|на|в)/.test(low) ||
    new RegExp(`${CYR_TOKEN_L}какие\\s+(у\\s+меня\\s+)?`, 'i').test(low) ||
    /^(покажи|открой|выведи)(\s|$)/.test(low) ||
    (/^расскажи/i.test(low) && /календар/i.test(low)) ||
    /^как\s+(мне\s+)?(посмотреть|узнать|открыть|показать)/.test(low)
  );
}

function userAskedForReminder(text) {
  const s = String(text || '');
  if (hasClassicReminderPhrase(s)) return true;

  /** Явный глагол + дни недели (в т.ч. «добавь … по понедельникам»). */
  if (weekdayRecurrenceCue(s) && calendarSchedulingVerbCue(s)) return true;

  /**
   * «Регулярное событие / календарь» + дни недели, без классического глагола —
   * но не вопрос про просмотр слотов.
   */
  if (
    weekdayRecurrenceCue(s) &&
    calendarOrScheduleDomainCue(s) &&
    !looksLikeScheduleOrCalendarQuestion(s)
  ) {
    return true;
  }

  /** Календарь / регулярные занятия + глагол записи, даже без явного «по вторникам». */
  if (
    (/календар/i.test(s) ||
      /регулярн(?:ое|ые|ых)?(?:\s+собы|\s+событ|\s+занят)/i.test(s)) &&
    calendarSchedulingVerbCue(s)
  ) {
    return true;
  }

  /** Follow-up later without the word «напомни» (recovery path + model hint). */
  return /через\s+\d+\s+(день|дня|дней)[^.!?]{0,80}(уточнить|проверить|спросить|написать|напомнить\s+себе)/i.test(
    s
  );
}

/** Мин. длина реплики с голоса, чтобы считать её «содержательной» для implicit write. */
const VOICE_IMPLICIT_MIN_CHARS = 40;
/** Ниже этого порога «только список файлов» отсекает implicit; длинная речь — всё равно в захват. */
const VOICE_IMPLICIT_LONG_BYPASS = 200;

/**
 * Voice/audio/video notes are usually substantive dumps; treat long ones as save-worthy
 * so orchestrator + inbox fallback run without explicit «запомни».
 * Длинные надиктовки не отсекаем из-за слов «проекты / база» внутри текста (эвристика inventory).
 */
function implicitCaptureFromMedia(via, text) {
  const v = String(via || 'text');
  if (!/^(voice|audio|video_note)$/.test(v)) return false;
  const s = String(text || '');
  const len = s.length;
  if (len < VOICE_IMPLICIT_MIN_CHARS) return false;
  if (len >= VOICE_IMPLICIT_LONG_BYPASS) return true;
  if (userAskedForMemoryInventory(s)) return false;
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
