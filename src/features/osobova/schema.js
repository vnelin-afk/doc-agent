// Spec schema for Особова картка працівника (форма П-2)
// Contract between AI parser and document generator.

export const OSOBOVA_FIELDS = [
	// ── Організація ─────────────────────────────────────────────
	{ key: 'org_name',          label: 'Назва організації',              group: 'org',        source: 'order',    required: true },
	{ key: 'org_edrpou',        label: 'ЄДРПОУ організації',             group: 'org',        source: 'order',    required: true },

	// ── Зайнятість ───────────────────────────────────────────────
	{ key: 'tabel_number',      label: 'Табельний номер',                group: 'employment', source: 'order',    required: false },
	{ key: 'department',        label: 'Підрозділ',                      group: 'employment', source: 'order',    required: false },
	{ key: 'position',          label: 'Посада',                         group: 'employment', source: 'order',    required: true },
	{ key: 'position_kp_code',  label: 'Код КП посади',                  group: 'employment', source: 'order',    required: false },
	{ key: 'employment_type',   label: 'Вид зайнятості',                 group: 'employment', source: 'order',    required: true },
	{ key: 'salary',            label: 'Оклад (тарифна ставка)',         group: 'employment', source: 'order',    required: false },
	{ key: 'hire_date',         label: 'Дата прийняття',                 group: 'employment', source: 'order',    required: true },
	{ key: 'hire_order_number', label: 'Номер наказу про прийняття',     group: 'employment', source: 'order',    required: true },
	{ key: 'hire_order_date',   label: 'Дата наказу про прийняття',      group: 'employment', source: 'order',    required: true },
	{ key: 'order_number_date', label: 'Наказ (повний реквізит)',         group: 'employment', source: 'order',    required: false },
	{ key: 'work_experience_date', label: 'Загальний стаж станом на дату', group: 'employment', source: 'order', required: false },
	{ key: 'prev_work_place',   label: 'Останнє місце роботи',           group: 'employment', source: 'workbook', required: false },
	{ key: 'prev_work_position',label: 'Посада на попередньому місці',   group: 'employment', source: 'workbook', required: false },
	{ key: 'work_exp_years',    label: 'Стаж роботи (роки)',             group: 'employment', source: 'workbook', required: false },
	{ key: 'work_exp_months',   label: 'Стаж роботи (місяці)',           group: 'employment', source: 'workbook', required: false },

	// ── Особа ────────────────────────────────────────────────────
	{ key: 'last_name',         label: 'Прізвище',                       group: 'personal',   source: 'passport', required: true },
	{ key: 'first_name',        label: "Ім'я",                           group: 'personal',   source: 'passport', required: true },
	{ key: 'patronymic',        label: 'По батькові',                    group: 'personal',   source: 'passport', required: false },
	{ key: 'full_name',         label: 'ПІБ повністю',                   group: 'personal',   source: 'passport', required: true },
	{ key: 'birth_date',        label: 'Дата народження',                group: 'personal',   source: 'passport', required: true },
	{ key: 'birth_place',       label: 'Місце народження',               group: 'personal',   source: 'passport', required: true },
	{ key: 'gender',            label: 'Стать',                          group: 'personal',   source: 'passport', required: true },
	{ key: 'citizenship',       label: 'Громадянство',                   group: 'personal',   source: 'passport', required: true },
	{ key: 'tax_id',            label: 'РНОКПП (ІПН)',                   group: 'personal',   source: 'evod',     required: true },
	{ key: 'marital_status',    label: 'Сімейний стан',                  group: 'personal',   source: 'evod',     required: false },
	{ key: 'children_count',    label: 'Кількість дітей',                group: 'personal',   source: 'evod',     required: false },
	{ key: 'pension_info',      label: 'Пенсія',                         group: 'personal',   source: 'other',    required: false },

	// ── Документ (паспорт / ID-карта) ────────────────────────────
	{ key: 'passport_type',          label: 'Тип документа',             group: 'passport',   source: 'passport', required: true },
	{ key: 'passport_series',        label: 'Серія паспорта',            group: 'passport',   source: 'passport', required: false },
	{ key: 'passport_number',        label: 'Номер паспорта/ID',         group: 'passport',   source: 'passport', required: true },
	{ key: 'passport_issued_by',     label: 'Ким виданий',               group: 'passport',   source: 'passport', required: true },
	{ key: 'passport_issue_date',    label: 'Дата видачі',               group: 'passport',   source: 'passport', required: true },
	{ key: 'passport_expiry_date',   label: 'Дійсний до',                group: 'passport',   source: 'passport', required: false },
	{ key: 'passport_record_number', label: 'УНЗР (для ID-карти)',       group: 'passport',   source: 'passport', required: false },

	// ── Адреса та контакти ────────────────────────────────────────
	{ key: 'address_registration',   label: 'Адреса реєстрації',         group: 'contacts',   source: 'passport', required: true },
	{ key: 'address_actual',         label: 'Фактична адреса',           group: 'contacts',   source: 'evod',     required: false },
	{ key: 'phone',                  label: 'Телефон',                   group: 'contacts',   source: 'evod',     required: false },
	{ key: 'email',                  label: 'Email',                     group: 'contacts',   source: 'evod',     required: false },

	// ── Освіта ────────────────────────────────────────────────────
	{ key: 'education_level',        label: 'Рівень освіти',             group: 'education',  source: 'diploma',  required: true },
	{ key: 'education_institution',  label: 'Навчальний заклад',         group: 'education',  source: 'diploma',  required: true },
	{ key: 'education_faculty',      label: 'Факультет',                 group: 'education',  source: 'diploma',  required: false },
	{ key: 'education_specialty',    label: 'Спеціальність',             group: 'education',  source: 'diploma',  required: true },
	{ key: 'education_qualification',label: 'Кваліфікація',              group: 'education',  source: 'diploma',  required: false },
	{ key: 'edu_form',               label: 'Форма навчання',            group: 'education',  source: 'diploma',  required: false },
	{ key: 'diploma_series',         label: 'Серія диплома',             group: 'education',  source: 'diploma',  required: false },
	{ key: 'diploma_number',         label: 'Номер диплома',             group: 'education',  source: 'diploma',  required: true },
	{ key: 'diploma_date',           label: 'Дата видачі диплома',       group: 'education',  source: 'diploma',  required: false },
	{ key: 'graduation_year',        label: 'Рік закінчення',            group: 'education',  source: 'diploma',  required: true },

	// ── Військовий облік (eVOD) ───────────────────────────────────
	{ key: 'military_rank',          label: 'Військове звання',          group: 'military',   source: 'evod',     required: false },
	{ key: 'military_category',      label: 'Категорія запасу',          group: 'military',   source: 'evod',     required: false },
	{ key: 'military_specialty_code',label: 'ВОС (код)',                 group: 'military',   source: 'evod',     required: false },
	{ key: 'military_unit',          label: 'ТЦК / РВК',                group: 'military',   source: 'evod',     required: false },
	{ key: 'mil_fitness',            label: 'Придатність до служби',     group: 'military',   source: 'evod',     required: false },
	{ key: 'mil_tck_registered',     label: 'ТЦК та СП за місцем реєстрації', group: 'military', source: 'evod', required: false },
	{ key: 'mil_oberig',             label: 'Номер в реєстрі Оберіг',          group: 'military', source: 'evod', required: false },

	// ── Службове ─────────────────────────────────────────────────
	{ key: 'fill_date',              label: 'Дата заповнення картки',    group: 'service',    source: 'order',    required: false },
	{ key: 'order_signatory_position', label: 'Посада підписанта наказу',  group: 'service',    source: 'order',    required: false },
	{ key: 'order_signatory_name',     label: 'ПІБ підписанта (Ім\'я ПРІЗВИЩЕ)', group: 'service', source: 'order', required: false },
];

export function emptyOsobovaSpec() {
	return Object.fromEntries(OSOBOVA_FIELDS.map(f => [f.key, '']));
}

// Flat map of placeholder name → field key (same; kept for template generation reference)
export const PLACEHOLDERS = Object.fromEntries(OSOBOVA_FIELDS.map(f => [f.key.toUpperCase(), f.key]));
