import React from 'react';

function Block({ title, children, className = '' }) {
  return (
    <div className={'flow-block ' + className}>
      <strong className="flow-block-title">{title}</strong>
      <div className="flow-block-body">{children}</div>
    </div>
  );
}

function Arrow() {
  return <div className="flow-arrow" aria-hidden="true">↓</div>;
}

function SideNote({ children }) {
  return <p className="flow-side">{children}</p>;
}

/** Статическая карта пайплайна — соответствует типичному коду репозитория (ядро без привязки к версии строк). */
export function AgentFlowDiagram() {
  return (
    <div className="stack flow-page">
      <section className="card flow-intro">
        <h2>Схема данных</h2>
        <p className="muted">
          Это упрощённая карта: где появляется текст, где хранится и какие автоматические процессы его трогают.
          Так проще синхронизировать обсуждение с кодом (<code>core/agent.js</code>,{' '}
          <code>core/watchers/daily_review.js</code>,{' '}
          <code>core/watchers/inbox_triage.js</code>).
        </p>
      </section>

      <div className="flow-columns">
        <section className="card flow-column">
          <h3 className="flow-column-title">Обычный диалог</h3>
          <p className="muted flow-column-lead">Сообщение → модель → инструменты → файлы.</p>

          <Block title="Telegram / веб-дашборд">
            Входящие сообщения и команды. Веб читает заметки и настройки через HTTP API с токеном.
          </Block>
          <Arrow />

          <Block title="Журнал дня">
            Каждая реплика пишется в <code>memory/journal/</code> — это «что было сказано» без сокращений
            модели.
          </Block>
          <Arrow />

          <Block title="История чата для LLM">
            Сохранённый контекст для OpenRouter в <code>memory/history/</code> (системный промпт из{' '}
            <code>core/prompts/system.md</code>).
          </Block>
          <Arrow />

          <Block title="runAgent">
            <code>core/agent.js</code>: один или несколько шагов чата; при явном «сохрани в базу» может
            подключаться подсказка маршрута из <code>core/knowledge_orchestrator.js</code>.
          </Block>
          <Arrow />

          <Block title="Инструменты">
            <code>write_note</code>, <code>list_notes</code>, <code>read_note</code>, напоминания, при
            необходимости shell — см. <code>core/tools/</code>.
          </Block>
          <Arrow />

          <Block title="Заметки на диске" className="flow-block-accent">
            Итог попадает в <code>memory/notes/**/*.md</code>. Индекс проектов для маршрута —{' '}
            <code>projects/_index.md</code> (редактируете вы).
          </Block>
        </section>

        <section className="card flow-column">
          <h3 className="flow-column-title">Вечерняя сводка и траж</h3>
          <p className="muted flow-column-lead">По расписанию, после сохранения сводки — разбор инбокса.</p>

          <Block title="Планировщик (cron)">
            <code>core/watchers/daily_review.js</code> + настройки <code>dailyReview.*</code>. Можно вызвать
            вручную командой <code>/summary</code> в Telegram.
          </Block>
          <Arrow />

          <Block title="Сводка за день">
            Модель читает журнал и прошлые summary → файл{' '}
            <code>memory/notes/summary-YYYY-MM-DD.md</code> и документ в Telegram.
          </Block>
          <Arrow />

          <Block title="Траж инбокса (triage)">
            Если включено: второй проход по содержимому <code>inbox.md</code> с инструментами только{' '}
            list/read/write. Снимок до разбора — <code>inbox/archive/</code>.
            <SideNote>
              Раньше инбокс мог «очиститься» без успешных записей; теперь по умолчанию очистка только после
              хотя бы одного успешного <code>write_note</code>.
            </SideNote>
          </Block>
          <Arrow />

          <Block title="Журнал тража" className="flow-block-accent">
            Каждый запуск добавляет строку в{' '}
            <code>memory/logs/inbox_triage.jsonl</code> — время, число записей, очищен ли инбокс, ошибки.
            Смотри вкладку «Журнал тража» в этом дашборде.
          </Block>
        </section>
      </div>
    </div>
  );
}
