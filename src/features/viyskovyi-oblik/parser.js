import { arrayBufferToBase64, extractDocxText, pdfHasTextLayer } from '../../lib/utils.js';
import { json } from '../../lib/response.js';
import * as XLSX from 'xlsx';
import { VO_FIELDS } from './schema.js';

// Системні промти — точний текст/поля з Obsidian projects/doc-agent/features/viyskovyi-oblik/prompts.md.
// Відхилення від prompts.md: додано {value, confidence} на кожне поле (за зразком COMMON_RULES у osobova/index.js) —
// prompts.md описував лише плоскі значення, але T003 (review UI) вимагає confidence-badges для кожної клітинки,
// тож формат відповіді розширено, а не перевинайдено.
const CARD_COMMON_RULES = `Правила:
- Дати можуть бути словесні українською або РОСІЙСЬКОЮ (артефакт джерела, напр. "17 мая 2007 г.", "20 сентября 2013 г.") — розпізнавай обидва варіанти назв місяців, завжди повертай ISO (YYYY-MM-DD)
- Якщо ім'я і по батькові злиті в одному полі — перше слово ім'я, решта по батькові
- registered_address_p12 і actual_address_p11 називай суворо за номером пункту картки, не за змістом — інверсію (п.12→кол.11, п.11→кол.12) робить інший сервіс
- Порожні поля — value: null, confidence: "missing". Не вигадувати значення
- confidence: "high" = дані явно читаються, "low" = виведено або нечітко, "missing" = поле відсутнє
- Обрізай зайві пробіли на початку і в кінці кожного значення (trim)
- Поверни ТІЛЬКИ валідний JSON без тексту до або після`;

const CARD_PROMPT = `Витягни дані про працівника з Особової картки П-2 (розділи І та ІІ). Поверни ТІЛЬКИ JSON, кожне поле — {"value": ..., "confidence": "high"|"low"|"missing"}:

{
  "military_rank": {"value": "звання як у картці", "confidence": "high"},
  "surname": {"value": "...", "confidence": "high"},
  "first_name": {"value": "...", "confidence": "high"},
  "patronymic": {"value": "...", "confidence": "high"},
  "birth_date": {"value": "YYYY-MM-DD", "confidence": "high"},
  "inn": {"value": "індивідуальний ідентифікаційний номер з шапки картки (розділ І)", "confidence": "high"},
  "military_reg_number": {"value": "номер з поля 'Перебування на спеціальному обліку' в розділі ІІ (реєстраційний номер ЄДР, ~21 цифра, не плутати з inn)", "confidence": "high"},
  "vos_code": {"value": "військово-облікова спеціальність №", "confidence": "high"},
  "composition": {"value": "поле 'Склад', null якщо рядовий/сержантський склад (лише для офіцерів)", "confidence": "high"},
  "registration_category": {"value": "текст поля 'Категорія обліку'", "confidence": "high"},
  "diploma_series_number": {"value": "серія + номер диплому разом, як надруковано", "confidence": "high"},
  "diploma_specialty": {"value": "Спеціальність (професія) за дипломом", "confidence": "high"},
  "passport_series": {"value": "...", "confidence": "high"},
  "passport_number": {"value": "...", "confidence": "high"},
  "passport_issued_by": {"value": "...", "confidence": "high"},
  "passport_issue_date": {"value": "YYYY-MM-DD", "confidence": "high"},
  "registered_address_p12": {"value": "адреса з пункту 12 картки, рівно як написано, без інверсії", "confidence": "high"},
  "actual_address_p11": {"value": "адреса з пункту 11 картки, рівно як написано, без інверсії", "confidence": "high"},
  "tsk_name": {"value": "назва райвійськкомату за місцем реєстрації", "confidence": "high"},
  "fitness_for_service": {"value": "...", "confidence": "high"},
  "family_status": {"value": "null якщо таблиця родинного стану порожня", "confidence": "high"}
}

${CARD_COMMON_RULES}`;

const ORDER_PROMPT = `Витягни дані з Наказу про прийняття на роботу. Поверни ТІЛЬКИ JSON, кожне поле — {"value": ..., "confidence": "high"|"low"|"missing"}:

{
  "org_name": {"value": "скорочена назва компанії з шапки наказу, як у дужках (напр. ТОВ «Назва»)", "confidence": "high"},
  "full_name": {"value": "ПІБ у називному відмінку, формат 'Прізвище Ім'я По-батькові' (прізвище першим), для звірки з карткою", "confidence": "high"},
  "position": {"value": "посада у НАЗИВНОМУ відмінку (напр. 'директор', НЕ 'директора'; 'бухгалтер', НЕ 'бухгалтера')", "confidence": "high"},
  "order_number": {"value": "номер наказу без символу №", "confidence": "high"},
  "order_date": {"value": "YYYY-MM-DD, дата з шапки наказу", "confidence": "high"},
  "employment_start_date": {"value": "YYYY-MM-DD, дата ЗСЕРЕДИНИ тексту наказу з фрази типу 'з 11 листопада 2025 року' (може відрізнятись від order_date — якщо в наказі лише одна дата, дорівнює order_date)", "confidence": "high"}
}

Правила:
- Шукай рядок що починається з "Я," або "ПРИЙНЯТИ:"
- position ніколи не переставляти слова місцями відносно оригіналу
- confidence: "high" = дані явно читаються, "low" = виведено або нечітко, "missing" = поле відсутнє
- Поверни ТІЛЬКИ валідний JSON без тексту до або після`;

// ── XLSX → текст (merged cells flatten) ────────────────────────────────────────
// Генерична утиліта: аналогів немає ні в lib/utils.js, ні в osobova (там — фіксований cellMap за точними
// координатами, без AI). Тут макет картки не гарантовано фіксований, тож дампимо рядки як текст і даємо
// Claude самому зіставити label/value — той самий принцип що й extractDocxText (сирий текст + AI).
export function xlsxToText(buffer) {
	const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
	const lines = [];
	for (const sheetName of wb.SheetNames) {
		const ws = wb.Sheets[sheetName];
		const ref = ws['!ref'];
		if (!ref) continue;
		const range = XLSX.utils.decode_range(ref);
		for (let r = range.s.r; r <= range.e.r; r++) {
			const rowValues = [];
			for (let c = range.s.c; c <= range.e.c; c++) {
				const cell = ws[XLSX.utils.encode_cell({ r, c })];
				if (cell && cell.v != null && String(cell.v).trim() !== '') {
					rowValues.push(String(cell.v).trim());
				}
			}
			if (rowValues.length > 0) lines.push(rowValues.join(' | '));
		}
	}
	return lines.join('\n');
}

// ── Claude call wrapper (за зразком osobova/index.js callClaude) ───────────────
async function callClaude(contentBlocks, systemPrompt, hasPdf, env) {
	const headers = {
		'Content-Type': 'application/json',
		'x-api-key': env.CLAUDE_API_KEY,
		'anthropic-version': '2023-06-01',
	};
	if (hasPdf) headers['anthropic-beta'] = 'pdfs-2024-09-25';

	const res = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers,
		body: JSON.stringify({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 2048,
			system: systemPrompt,
			messages: [{ role: 'user', content: contentBlocks }],
		}),
	});

	if (!res.ok) {
		await res.text().catch(() => '');
		return null;
	}
	const data = await res.json();
	if (data.error) return null;
	const raw = data.content?.[0]?.text ?? '{}';
	try {
		const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
		const match = clean.match(/\{[\s\S]*\}/);
		return match ? JSON.parse(match[0]) : {};
	} catch {
		return {};
	}
}

async function parseCard(file, env) {
	const ext = file.name.split('.').pop().toLowerCase();
	const buffer = await file.arrayBuffer();
	let contentBlocks;
	let hasPdf = false;

	if (ext === 'pdf') {
		hasPdf = true;
		contentBlocks = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: arrayBufferToBase64(buffer) }, title: file.name }];
	} else if (ext === 'xlsx' || ext === 'xls') {
		const text = xlsxToText(buffer);
		if (text.length < 20) return { error: 'empty_content', source_file: file.name };
		contentBlocks = [{ type: 'text', text }];
	} else {
		return { error: 'unsupported_card_format', source_file: file.name };
	}

	const parsed = await callClaude(contentBlocks, CARD_PROMPT, hasPdf, env);
	if (!parsed || Object.keys(parsed).length === 0) return { error: 'parse_failed', source_file: file.name };
	return { parsed, source_file: file.name };
}

async function parseOrder(file, env) {
	const buffer = await file.arrayBuffer();
	const text = await extractDocxText(buffer);
	if (text.length < 20) return { error: 'empty_content', source_file: file.name };

	const parsed = await callClaude([{ type: 'text', text }], ORDER_PROMPT, false, env);
	if (!parsed || Object.keys(parsed).length === 0) return { error: 'parse_failed', source_file: file.name };
	return { parsed, source_file: file.name };
}

// ── Fuzzy matching картки ↔ наказу ──────────────────────────────────────────────
// Портовано з extractParts/matchTabNumber (src/features/timesheet/index.js) — та сама логіка
// прізвище+ініціали, адаптована під пару "картка ↔ наказ" замість "ПІБ ↔ табельний номер".
function extractNameParts(name) {
	if (!name) return {};
	name = name.trim();
	const m2 = name.match(/^(\S+)\s+(\S)\.(\S)\./u);
	if (m2) return { surname: m2[1], firstInitial: m2[2].toUpperCase(), patronymicInitial: m2[3].toUpperCase() };
	const m1 = name.match(/^(\S)\.(\S)\.(\S+)$/u);
	if (m1) return { surname: m1[3], firstInitial: m1[1].toUpperCase(), patronymicInitial: m1[2].toUpperCase() };
	const parts = name.split(/\s+/);
	return {
		surname: parts[0] || '',
		firstInitial: parts[1]?.[0]?.toUpperCase() || '',
		patronymicInitial: parts[2]?.[0]?.toUpperCase() || '',
	};
}

function matchEmployeePair(cardFullName, orderCandidates) {
	const target = extractNameParts(cardFullName);
	if (!target.surname) return null;

	let best = null;
	let bestScore = 0;
	for (const order of orderCandidates) {
		const orderName = order.parsed?.full_name?.value;
		const cand = extractNameParts(orderName);
		if (!cand.surname || cand.surname.toLowerCase() !== target.surname.toLowerCase()) continue;
		let score = 10;
		if (target.firstInitial && cand.firstInitial && cand.firstInitial === target.firstInitial) score += 3;
		if (target.patronymicInitial && cand.patronymicInitial && cand.patronymicInitial === target.patronymicInitial) score += 2;
		if (score > bestScore) {
			bestScore = score;
			best = order;
		}
	}
	return bestScore >= 10 ? best : null;
}

// ── Форматування ────────────────────────────────────────────────────────────────
function formatDateUA(iso) {
	if (!iso) return '';
	const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return String(iso);
	return `${m[3]}.${m[2]}.${m[1]}`;
}

function capitalizeFirst(s) {
	if (!s) return '';
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function val(field) {
	return field && field.value != null ? String(field.value).trim() : '';
}

function conf(field) {
	if (!field || field.value == null || field.value === '') return 'missing';
	return field.confidence === 'high' ? 'high' : 'low';
}

// ── Побудова employee spec за мепінгом (mapping.md) ─────────────────────────────
function buildEmployeeSpec(card, order) {
	const spec = Object.fromEntries(VO_FIELDS.map(f => [f.key, '']));
	const confidence = {};

	const surname = val(card.surname);
	const firstName = val(card.first_name);
	const patronymic = val(card.patronymic);

	spec.military_rank = capitalizeFirst(val(card.military_rank));
	confidence.military_rank = conf(card.military_rank);

	spec.full_name = surname ? `${surname.toUpperCase()} ${firstName} ${patronymic}`.trim() : '';
	confidence.full_name = surname && firstName ? 'high' : 'low';

	spec.birth_date = formatDateUA(val(card.birth_date));
	confidence.birth_date = conf(card.birth_date);

	const inn = val(card.inn);
	const regNum = val(card.military_reg_number);
	spec.reg_number = regNum || inn ? `${regNum}/${inn}` : '';
	confidence.reg_number = conf(card.military_reg_number) === 'high' && conf(card.inn) === 'high' ? 'high' : 'low';

	spec.vos_code = val(card.vos_code);
	confidence.vos_code = conf(card.vos_code);

	spec.composition = val(card.composition);
	confidence.composition = conf(card.composition);

	// I005/D006: колонка 8 = лише категорія обліку, без дати (дата йде окремо в колонку 18, D004).
	const category = val(card.registration_category);
	const startDate = order ? formatDateUA(val(order.employment_start_date)) : '';
	spec.registration_category = category;
	confidence.registration_category = conf(card.registration_category);

	const diploma = val(card.diploma_series_number);
	const specialty = val(card.diploma_specialty);
	spec.education = diploma || specialty ? `${diploma}\n"${specialty}"`.trim() : '';
	confidence.education = diploma && specialty ? 'high' : 'low';

	const passSeries = val(card.passport_series);
	const passNumber = val(card.passport_number);
	const passIssuedBy = val(card.passport_issued_by);
	const passDate = formatDateUA(val(card.passport_issue_date));
	spec.passport = passNumber ? `серія ${passSeries} №${passNumber}, ким виданий ${passIssuedBy}, дата видачі ${passDate}` : '';
	confidence.passport = passNumber && passIssuedBy && passDate ? 'high' : 'low';

	// Інверсія (мепінг п.11/12): картка п.12 → колонка "registered_address", картка п.11 → колонка "actual_address"
	spec.registered_address = val(card.registered_address_p12);
	confidence.registered_address = conf(card.registered_address_p12);
	spec.actual_address = val(card.actual_address_p11);
	confidence.actual_address = conf(card.actual_address_p11);

	spec.tsk_name = val(card.tsk_name);
	confidence.tsk_name = conf(card.tsk_name);

	// Колонка 14 — джерела немає в жодному з вхідних документів, завжди порожньо
	spec.spec_registration = '';
	confidence.spec_registration = 'missing';

	spec.fitness = val(card.fitness_for_service);
	confidence.fitness = conf(card.fitness_for_service);

	// Плейсхолдер-логіка для порожнього сімейного стану остаточно не уточнена (мапінг.md) — лишаємо порожнім, не вигадуємо
	spec.family_status = val(card.family_status);
	confidence.family_status = conf(card.family_status);

	if (order) {
		const position = val(order.position);
		const orderNumber = val(order.order_number);
		const orderDate = formatDateUA(val(order.order_date));
		spec.position_order = position ? `${position}\nНаказ № ${orderNumber} від ${orderDate}` : '';
		confidence.position_order = position && orderNumber && orderDate ? 'high' : 'low';

		// I003/D004: колонка 18 — автоматично, той самий startDate що й колонка 8 (без повторного парсингу наказу).
		spec.notification_manual = startDate ? `б.н. від ${startDate}` : '';
		confidence.notification_manual = startDate ? conf(order.employment_start_date) : 'missing';
	} else {
		confidence.position_order = 'missing';
		spec.notification_manual = '';
		confidence.notification_manual = 'missing';
	}

	return { spec, confidence };
}

// ── Endpoint ─────────────────────────────────────────────────────────────────────
export async function viyskovyiOblikParse(request, env, cors) {
	const formData = await request.formData();

	const cardFiles = [];
	const orderFiles = [];
	for (const [, file] of formData.entries()) {
		if (!(file instanceof File)) continue;
		const ext = file.name.split('.').pop().toLowerCase();
		if (ext === 'pdf' || ext === 'xlsx' || ext === 'xls') cardFiles.push(file);
		else if (ext === 'docx') orderFiles.push(file);
	}

	const errors = [];

	const cardResults = await Promise.all(cardFiles.map(f => parseCard(f, env)));
	const orderResults = await Promise.all(orderFiles.map(f => parseOrder(f, env)));

	const validCards = [];
	for (const r of cardResults) {
		if (r.error) errors.push(r);
		else validCards.push(r);
	}
	const validOrders = [];
	for (const r of orderResults) {
		if (r.error) errors.push(r);
		else validOrders.push(r);
	}

	const employees = [];
	const unmatchedOrders = new Set(validOrders);
	const unmatchedCards = [];

	for (const card of validCards) {
		const cardFullName = `${val(card.parsed.surname)} ${val(card.parsed.first_name)} ${val(card.parsed.patronymic)}`.trim();
		const matchedOrder = matchEmployeePair(cardFullName, [...unmatchedOrders]);
		if (matchedOrder) unmatchedOrders.delete(matchedOrder);
		else unmatchedCards.push(card);

		const { spec, confidence } = buildEmployeeSpec(card.parsed, matchedOrder?.parsed);
		employees.push({
			spec,
			confidence,
			source_files: [card.source_file, matchedOrder?.source_file].filter(Boolean),
		});
	}

	const unmatched = [...unmatchedCards.map(c => ({ type: 'card', source_file: c.source_file })), ...[...unmatchedOrders].map(o => ({ type: 'order', source_file: o.source_file }))];

	const orgName = validOrders.find(o => val(o.parsed?.org_name))?.parsed?.org_name?.value?.trim() || '';

	return json({ employees, unmatched, errors, org_name: orgName }, cors);
}
