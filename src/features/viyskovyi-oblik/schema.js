// Spec schema for Список персонального військового обліку (Додаток 5)
// Contract between AI parser and document generator.
// Порядковий номер (колонка 1) не зберігається тут — генерується при рендері (наскрізна нумерація), як vacation employee.index.
// Повний мепінг: Obsidian projects/doc-agent/features/viyskovyi-oblik/mapping.md

export const VO_FIELDS = [
	// ── Картка П-2 ───────────────────────────────────────────────
	{ key: 'military_rank',       label: 'Військове звання',                                  group: 'card',    source: 'card',    required: true },
	{ key: 'full_name',           label: 'ПІБ',                                               group: 'identity',source: 'both',    required: true },
	{ key: 'birth_date',          label: 'Дата народження',                                   group: 'card',    source: 'card',    required: true },
	{ key: 'reg_number',          label: 'Реєстраційний номер ЄДР/ІПН',                       group: 'card',    source: 'card',    required: true },
	{ key: 'vos_code',            label: 'Військово-облікова спеціальність',                  group: 'card',    source: 'card',    required: false },
	{ key: 'composition',         label: 'Склад (для офіцера)',                               group: 'card',    source: 'card',    required: false },
	{ key: 'registration_category', label: 'Категорія обліку',                                 group: 'card',    source: 'card',    required: true },
	{ key: 'education',           label: 'Освіта та спеціальність',                           group: 'card',    source: 'card',    required: false },
	{ key: 'passport',            label: 'Паспорт',                                          group: 'card',    source: 'card',    required: true },
	// Увага: інверсія — картка п.12 → колонка 11, картка п.11 → колонка 12 (мепінг п.11/12)
	{ key: 'registered_address',  label: 'Адреса зареєстрованого місця проживання',           group: 'card',    source: 'card',    required: true },
	{ key: 'actual_address',      label: 'Адреса місця проживання (фактична)',                group: 'card',    source: 'card',    required: false },
	{ key: 'tsk_name',            label: 'Найменування ТЦК та СП',                            group: 'card',    source: 'card',    required: true },
	// Джерела немає в обох тестових кейсах — не плутати з колонкою reg_number (5)
	{ key: 'spec_registration',   label: 'Перебування на спецобліку/резерв',                  group: 'none',    source: 'none',    required: false },
	{ key: 'fitness',             label: 'Придатність до військової служби',                  group: 'card',    source: 'card',    required: true },
	{ key: 'family_status',       label: "Сімейний стан, ПІБ членів сім'ї, рік народження",   group: 'card',    source: 'card',    required: false },

	// ── Наказ ────────────────────────────────────────────────────
	{ key: 'position_order',     label: 'Посада, реквізити акта про призначення',            group: 'order',   source: 'order',   required: true },
	// I003/D004: автоматично з дати виходу на роботу з наказу (той самий startDate що й registration_category), формат "б.н. від ДД.ММ.РРРР"
	{ key: 'notification_manual', label: 'Реквізити повідомлення про призначення/звільнення', group: 'order',   source: 'order',   required: false },
];

export function emptyVoEmployeeSpec() {
	return Object.fromEntries(VO_FIELDS.map(f => [f.key, '']));
}

// Flat map of placeholder name → field key (same; kept for template generation reference)
export const PLACEHOLDERS = Object.fromEntries(VO_FIELDS.map(f => [f.key.toUpperCase(), f.key]));
