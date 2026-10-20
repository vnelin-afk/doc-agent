import * as XLSX from 'xlsx';
import { arrayBufferToBase64, extractDocxText, pdfHasTextLayer } from '../../lib/utils.js';
import { json } from '../../lib/response.js';
import { OSOBOVA_FIELDS, emptyOsobovaSpec } from './schema.js';
import { OSOBOVA_CELL_MAP } from '../../osobova/cellMap.js';

const COMMON_RULES = `Правила:
- Обрізай зайві пробіли на початку і в кінці кожного значення (trim)
- confidence: "high" = дані явно читаються, "low" = виведено або нечітко, "missing" = поле відсутнє в документах
- Якщо поле не знайдено — value: null, confidence: "missing"
- Дати: формат DD.MM.YYYY
- Поверни ТІЛЬКИ валідний JSON без тексту до або після`;

const EXPERIENCE_PROMPT = `Витягни дані про трудовий досвід з наданого документа. Документ може бути eVOD (е-формат або скан) або трудова книжка. Поверни ТІЛЬКИ JSON:

{
  "prev_work_place": {"value": "...", "confidence": "high"},
  "prev_work_position": {"value": "...", "confidence": "high"},
  "work_exp_years": {"value": "3", "confidence": "high"},
  "work_exp_months": {"value": "11", "confidence": "high"}
}

Поля:
- prev_work_place: назва останнього роботодавця (останній рядок із "Прийнято" або останній запис у таблиці роботи)
- prev_work_position: остання посада з того ж запису
- work_exp_years: загальний стаж, років — ціле число у вигляді рядка (напр. "3")
- work_exp_months: загальний стаж, місяців — ціле число у вигляді рядка (напр. "11")

${COMMON_RULES}`;

const MILITARY_PROMPT = `Витягни дані військового обліку з наданого документа (eVOD / Оберіг / ТЦК). Поверни ТІЛЬКИ JSON:

{
  "tax_id": {"value": "...", "confidence": "high"},
  "address_actual": {"value": "...", "confidence": "high"},
  "military_rank": {"value": "...", "confidence": "high"},
  "military_category": {"value": "...", "confidence": "high"},
  "military_specialty_code": {"value": "...", "confidence": "high"},
  "military_unit": {"value": "...", "confidence": "high"},
  "mil_fitness": {"value": "...", "confidence": "high"},
  "mil_tck": {"value": "...", "confidence": "high"},
  "mil_tck_registered": {"value": "...", "confidence": "high"},
  "mil_oberig": {"value": "...", "confidence": "high"}
}

Поля:
- mil_oberig: значення поля "Номер в реєстрі Оберіг" у блоці ТЦК та СП (довге числове значення, напр. "21062023145578400112")
- mil_tck: ТЦК за місцем фактичного проживання (НЕ плутати з mil_tck_registered)
- mil_tck_registered: ТЦК за місцем реєстрації (інший ТЦК, ніж mil_tck)
- mil_fitness: "придатний", "обмежено придатний", "непридатний" або точне формулювання з документу
- military_rank: військове звання
- military_category: категорія запасу
- military_specialty_code: ВОС (код військово-облікової спеціальності)
- military_unit: ТЦК за фактичним місцем проживання (те саме що mil_tck)

${COMMON_RULES}`;

const DIPLOMA_PROMPT = `Витягни дані про освіту з наданого диплому. Поверни ТІЛЬКИ JSON:

{
  "education_level": {"value": "...", "confidence": "high"},
  "education_institution": {"value": "...", "confidence": "high"},
  "education_faculty": {"value": "...", "confidence": "high"},
  "education_specialty": {"value": "...", "confidence": "high"},
  "education_qualification": {"value": "...", "confidence": "high"},
  "edu_form": {"value": "...", "confidence": "high"},
  "diploma_series": {"value": "...", "confidence": "high"},
  "diploma_number": {"value": "...", "confidence": "high"},
  "diploma_date": {"value": "...", "confidence": "high"},
  "graduation_year": {"value": "...", "confidence": "high"}
}

Поля:
- education_specialty: спеціальність за дипломом у називному відмінку (напр. "Право", "Фінанси") — НЕ кваліфікація, не у родовому відмінку; якщо на дипломі у родовому — конвертуй у називний
- education_qualification: кваліфікація у називному відмінку — ступінь і назву разом (напр. "Бакалавр права", "Магістр юриспруденції") — НЕ плутати зі спеціальністю; якщо на дипломі у родовому — конвертуй у називний
- education_level: "вища", "фахова передвища", "професійна (профтехосвіта)" тощо
- edu_form: "денна", "вечірня" або "заочна"; якщо явно не вказано — шукай у штампі або фразі "денна форма навчання"
- diploma_series: буквено-цифровий префікс номера диплому — все ДО знаку «№» або пробілу перед числовою частиною (напр. "М19", "M22", "КВ01"); серія може бути надрукована окремо від номера; якщо серія і номер записані разом без пробілу — все символи до першої цифри-групи = серія, решта = номер
- diploma_number: тільки числова частина після префіксу, без «№» та пробілів (напр. "181742")

${COMMON_RULES}`;

async function callClaude(contentBlocks, prompt, needsSonnet, hasPdf, env) {
	contentBlocks.push({ type: 'text', text: prompt });
	const model = needsSonnet ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
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
			model,
			max_tokens: 2048,
			system: `Ти — document extraction agent для Особової картки працівника (форма П-2). Відповідай ТІЛЬКИ валідним JSON без тексту до або після.`,
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

function mergeClaudeResult(parsed, spec, confidence) {
	for (const field of OSOBOVA_FIELDS) {
		const k = field.key;
		if (confidence[k] === 'high') continue;
		const entry = parsed[k];
		if (entry && entry.value !== null && entry.value !== undefined && entry.value !== '') {
			spec[k] = String(entry.value);
			confidence[k] = entry.confidence === 'high' ? 'high' : 'low';
		} else if (!confidence[k]) {
			confidence[k] = 'missing';
		}
	}
}

async function buildContentBlocks(files) {
	const contentBlocks = [];
	let hasPdf = false;
	let needsSonnet = false;

	for (const file of files) {
		const ext = file.name.split('.').pop().toLowerCase();
		const buffer = await file.arrayBuffer();

		if (ext === 'pdf') {
			hasPdf = true;
			if (!pdfHasTextLayer(buffer)) needsSonnet = true;
			contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: arrayBufferToBase64(buffer) }, title: file.name });
		} else if (ext === 'docx') {
			const text = await extractDocxText(buffer);
			if (text.length >= 20) contentBlocks.push({ type: 'text', text: `=== ${file.name} ===\n${text}` });
		} else {
			needsSonnet = true;
			const mediaType = ext === 'png' ? 'image/png' : 'image/jpeg';
			contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: arrayBufferToBase64(buffer) } });
		}
	}

	return { contentBlocks, hasPdf, needsSonnet };
}

// ── Notion ────────────────────────────────────────────────────────────────────

function parseRichText(prop) {
	if (!prop) return null;
	if (prop.type === 'rich_text') return prop.rich_text?.map(t => t.plain_text).join('') || null;
	if (prop.type === 'title') return prop.title?.map(t => t.plain_text).join('') || null;
	return null;
}

async function notionLookupSignatory(edrpou, spec, env) {
	try {
		const res = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_TCK_DB_ID}/query`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filter: { property: 'ЄДРПОУ компанії', rich_text: { equals: edrpou } }, page_size: 1 }),
		});
		const data = await res.json();
		if (!data.results?.length) return;

		const props = data.results[0].properties;
		spec._notion_page_id = data.results[0].id;

		const name = parseRichText(props['Директор (підписант)']);
		if (name && !spec.order_signatory_name) spec.order_signatory_name = name;
	} catch {
		// silent fail
	}
}

async function notionUpsertSignatory(spec, env) {
	try {
		const edrpou = spec.org_edrpou;
		if (!edrpou) return;
		const name = spec.order_signatory_name;
		if (!name) return;

		const rich = val => (val ? [{ text: { content: String(val) } }] : []);
		const properties = { 'Директор (підписант)': { rich_text: rich(name) } };

		if (spec._notion_page_id) {
			await fetch(`https://api.notion.com/v1/pages/${spec._notion_page_id}`, {
				method: 'PATCH',
				headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
				body: JSON.stringify({ properties }),
			});
		} else {
			properties['Назва компанії'] = { title: rich(edrpou) };
			properties['ЄДРПОУ компанії'] = { rich_text: rich(edrpou) };
			await fetch('https://api.notion.com/v1/pages', {
				method: 'POST',
				headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
				body: JSON.stringify({ parent: { database_id: env.NOTION_TCK_DB_ID }, properties }),
			});
		}
	} catch {
		// silent fail
	}
}

export async function osobovaParse(request, env, cors) {
	const formData = await request.formData();

	const filesBySlot = { excel1c: [], experience: [], military: [], diploma: [] };
	for (const [slot, file] of formData.entries()) {
		if (!(file instanceof File)) continue;
		if (filesBySlot[slot]) filesBySlot[slot].push(file);
	}

	const hasAny = Object.values(filesBySlot).some(arr => arr.length > 0);
	if (!hasAny) return json({ spec: emptyOsobovaSpec(), confidence: {} }, cors);

	const spec = emptyOsobovaSpec();
	const confidence = {};

	// Excel cellMap field names → spec field names (де різняться)
	const CELL_TO_SPEC = {
		date_filled:          'fill_date',
		ipn:                  'tax_id',
		work_type:            'employment_type',
		address_registered:   'address_registration',
		passport_issued_date: 'passport_issue_date',
		appointment_date:     'hire_date',
	};

	// Excel1c — механічне зчитування через cellMap
	for (const file of filesBySlot.excel1c) {
		const buffer = await file.arrayBuffer();
		const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
		const ws = wb.Sheets[wb.SheetNames[0]];
		if (!ws) continue;
		for (const [cellField, { r, c }] of Object.entries(OSOBOVA_CELL_MAP)) {
			const cellAddr = XLSX.utils.encode_cell({ r, c });
			const cell = ws[cellAddr];
			if (cell && cell.v != null && cell.v !== '') {
				const specField = CELL_TO_SPEC[cellField] ?? cellField;
				spec[specField] = String(cell.v).trim();
				confidence[specField] = 'high';
			}
		}
	}

	// Experience — AI парсинг
	if (filesBySlot.experience.length > 0) {
		const { contentBlocks, hasPdf, needsSonnet } = await buildContentBlocks(filesBySlot.experience);
		if (contentBlocks.length > 0) {
			const parsed = await callClaude(contentBlocks, EXPERIENCE_PROMPT, needsSonnet, hasPdf, env);
			if (parsed) mergeClaudeResult(parsed, spec, confidence);
		}
	}

	// Military — AI парсинг
	if (filesBySlot.military.length > 0) {
		const { contentBlocks, hasPdf, needsSonnet } = await buildContentBlocks(filesBySlot.military);
		if (contentBlocks.length > 0) {
			const parsed = await callClaude(contentBlocks, MILITARY_PROMPT, needsSonnet, hasPdf, env);
			if (parsed) mergeClaudeResult(parsed, spec, confidence);
		}
	}

	// Diploma — AI парсинг
	if (filesBySlot.diploma.length > 0) {
		const { contentBlocks, hasPdf, needsSonnet } = await buildContentBlocks(filesBySlot.diploma);
		if (contentBlocks.length > 0) {
			const parsed = await callClaude(contentBlocks, DIPLOMA_PROMPT, needsSonnet, hasPdf, env);
			if (parsed) mergeClaudeResult(parsed, spec, confidence);
		}
	}

	for (const field of OSOBOVA_FIELDS) {
		if (!confidence[field.key]) confidence[field.key] = 'missing';
	}

	if (spec.org_edrpou) {
		await notionLookupSignatory(spec.org_edrpou, spec, env);
	}

	return json({ spec, confidence }, cors);
}

export async function osobovaExcelDebug(request, env, cors) {
	const formData = await request.formData();
	const file = [...formData.values()].find(v => v instanceof File);
	if (!file) return json({ error: 'no file' }, cors, 400);

	const buffer = await file.arrayBuffer();
	const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });

	const result = {};
	for (const sheetName of wb.SheetNames) {
		const ws = wb.Sheets[sheetName];
		const cells = [];
		for (const [addr, cell] of Object.entries(ws)) {
			if (addr.startsWith('!')) continue;
			if (cell && cell.v != null && cell.v !== '') {
				const ref = XLSX.utils.decode_cell(addr);
				cells.push({ addr, r: ref.r, c: ref.c, v: String(cell.v).slice(0, 80) });
			}
		}
		result[sheetName] = {
			cells: cells.slice(0, 300),
			merges: (ws['!merges'] || []).slice(0, 50),
		};
	}
	return json(result, cors);
}

export async function handleOsobovaGenerate(request, env, cors) {
	const body = await request.json();
	const spec = body && body.spec ? body.spec : body;

	if (!spec || typeof spec !== 'object') {
		return json({ error: 'invalid_spec' }, cors, 400);
	}

	const months = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];
	const now = new Date();
	spec.work_experience_date = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

	if (spec.order_number_date) {
		spec.order_number_date = spec.order_number_date.replace(/^нак\.\s*/i, 'Наказ ');
	}

	if (spec.salary) {
		const s = String(spec.salary);
		const alreadyFormatted = /\d[\s ]\d/.test(s) && /,\d{2}$/.test(s);
		if (!alreadyFormatted) {
			const num = parseFloat(s.replace(/[\s ]/g, '').replace(',', '.'));
			if (!isNaN(num)) {
				spec.salary = num.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
			}
		}
	}

	let result;
	try {
		const resp = await fetch(env.APPS_SCRIPT_OSOBOVA_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ spec }),
			signal: AbortSignal.timeout(55000),
		});

		if (!resp.ok) {
			const text = await resp.text();
			return json({ error: 'apps_script_error', detail: text.slice(0, 300) }, cors, 502);
		}

		result = await resp.json();
	} catch (err) {
		return json({ error: 'apps_script_unreachable', detail: err.message }, cors, 502);
	}

	if (!result.ok) {
		return json({ error: 'generation_failed', detail: result.error }, cors, 500);
	}

	await notionUpsertSignatory(spec, env);

	return json({ ok: true, document_link: result.document_link, document_id: result.document_id }, cors);
}
