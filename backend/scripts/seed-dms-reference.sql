-- Стартовый справочник модуля «Документы»: 7 категорий + типовые документы.
-- Идемпотентно (ON CONFLICT DO NOTHING) — можно гонять повторно.
-- Категории и флаги пояснительной записки — по приёмочному тесту (план, фаза 8).
--
-- Это СТАРТОВЫЕ ДАННЫЕ, а не код: дальше их правит админка (фаза 2). Здесь они
-- лежат, чтобы новое пространство не начиналось с пустого экрана.
--
-- Запуск: psql -v slug=mig -f seed-dms-reference.sql

\set ws_slug :slug

INSERT INTO doc_groups (workspace_id, code, name, sort_order)
SELECT w.id, g.code, g.name, g.ord
FROM workspaces w, (VALUES
  ('KADRY',   'Кадрово-административные',      1),
  ('DOGOVOR', 'Договорные',                    2),
  ('FIN',     'Финансово-экономические',       3),
  ('ORG',     'Организационно-управленческие', 4),
  ('SEC',     'Безопасность и комплаенс',      5),
  ('IT',      'ИТ и инфраструктура',           6),
  ('PR',      'Коммуникации и PR',             7)
) AS g(code, name, ord)
WHERE w.slug = :'ws_slug'
ON CONFLICT DO NOTHING;

-- sla_days — срок согласования в рабочих днях (пока справочно: расчёт по
-- производственному календарю — фаза 7).
--
-- ★ requires_note ВЕЗДЕ false, хотя по приёмочному тесту записка нужна договорам,
-- закупкам ИТ, публикациям и т.д. Причина: бэкенд не выпустит такой документ на
-- согласование без записки, а формы записки ещё нет (фаза 4) — получился бы тупик.
-- Включить флаги, когда записка появится; это данные, правятся через админку.
INSERT INTO doc_types (workspace_id, group_id, code, name, registry_mask, requires_note, sla_days)
SELECT w.id, gr.id, t.code, t.name, t.mask, t.note, t.sla
FROM workspaces w
JOIN doc_groups gr ON gr.workspace_id = w.id
JOIN (VALUES
  -- код       группа      название                       маска                  записка  SLA
  ('DOG',     'DOGOVOR', 'Договор',                     'ДОГ-{YYYY}-{NNNN}',    false,   5),
  ('DS',      'DOGOVOR', 'Дополнительное соглашение',   'ДС-{YYYY}-{NNNN}',     false,   3),
  ('RAST',    'DOGOVOR', 'Расторжение договора',        'РАС-{YYYY}-{NNN}',     false,   3),
  ('PRIEM',   'KADRY',   'Приём сотрудника',            'ПР-{YYYY}-{NNN}',      false,  3),
  ('KOMAND',  'KADRY',   'Командировка',                'КМ-{YYYY}-{NNN}',      false,  2),
  ('OTPUSK',  'KADRY',   'Отпуск',                      'ОТП-{YYYY}-{NNN}',     false,  2),
  ('PLAT',    'FIN',     'Заявка на платёж',            'ЗП-{YYYY}-{NNNN}',     false,  2),
  ('PRIKAZ',  'ORG',     'Приказ',                      'ПРК-{YYYY}-{NNN}',     false,  3),
  ('POLOZH',  'ORG',     'Положение / регламент',       'ПОЛ-{YYYY}-{NNN}',     false,   5),
  ('DOSTUP',  'SEC',     'Предоставление доступа',      'ДСТ-{YYYY}-{NNN}',     false,  2),
  ('ZAKUP',   'IT',      'Закупка ИТ',                  'ЗАК-{YYYY}-{NNN}',     false,   5),
  ('SERVIS',  'IT',      'Подключение сервиса',         'СРВ-{YYYY}-{NNN}',     false,   3),
  ('SYSTEM',  'IT',      'Ввод системы в эксплуатацию', 'СИС-{YYYY}-{NNN}',     false,   5),
  ('PUBLIC',  'PR',      'Публикация',                  'ПУБ-{YYYY}-{NNN}',     false,   2),
  ('EVENT',   'PR',      'Мероприятие',                 'МЕР-{YYYY}-{NNN}',     false,   3)
) AS t(code, grp, name, mask, note, sla) ON t.grp = gr.code
WHERE w.slug = :'ws_slug'
ON CONFLICT DO NOTHING;
