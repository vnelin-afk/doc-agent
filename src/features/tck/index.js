import { arrayBufferToBase64, extractDocxText, pdfHasTextLayer, parseNotionProperty } from '../../lib/utils.js';
import { json } from '../../lib/response.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectTckDocType(filename) {
	const f = filename.toLowerCase();
	if (/наказ|order|прийн/.test(f)) return 'order';
	if (/військ|повістк|military|обліков/.test(f)) return 'military';
	if (/паспорт|passport/.test(f)) return 'passport';
	return 'unknown';
}

function buildEmptyTckSpec() {
	const f = () => ({ value: null, source: null, confidence: 'low' });
	return {
		employee: { full_name: f(), full_name_genitive: f(), rnokpp: f(), dob: f(), address: f(), phone: f() },
		employer: { org_name: f(), org_name_short: f(), edrpou: f(), address: f(), phone: f(), email: f(), director_name: f(), responsible_person: f(), responsible_phone: f(), source: null },
		military: { doc_type: f(), vos: f(), vos_description: f(), number: f(), doc_date: f(), issued_date: f(), tck_name: f(), category: f(), rank: f() },
		tck: { name: f(), name_locative: f(), address: f(), address_alternatives: [], search_status: 'not_searched' },
		order: { number: f(), date: f(), type: f(), event_date: f(), position: f() },
	};
}

function normalizePib(field) {
	if (!field || !field.value) return;
	const parts = field.value.trim().split(/\s+/);
	if (parts.length !== 3 || !parts.every(p => /^\p{Lu}/u.test(p))) {
		field.confidence = 'medium';
	}
}

function fuzzyDirectorMatch(a, b) {
	if (!a || !b) return false;
	const words = s => new Set(s.trim().toLowerCase().split(/\s+/));
	const aw = words(a);
	let overlap = 0;
	for (const w of words(b)) if (aw.has(w)) overlap++;
	return overlap >= 2;
}

function mergeTckSpecs(existing, newData, path, conflicts) {
	if (!newData || typeof newData !== 'object') return;

	for (const key of Object.keys(newData)) {
		const fieldPath = path ? `${path}.${key}` : key;
		const existingField = existing[key];
		const newField = newData[key];

		if (newField && typeof newField === 'object' && 'value' in newField && 'source' in newField) {
			if (newField.value === null) continue;
			if (!existingField || existingField.value === null || existingField.value === '') {
				existing[key] = newField;
			} else if (String(existingField.value) !== String(newField.value)) {
				conflicts.push({ field: fieldPath, old_value: existingField.value, old_source: existingField.source, new_value: newField.value, new_source: newField.source });
			}
		} else if (newField && typeof newField === 'object' && !Array.isArray(newField)) {
			if (!existing[key] || typeof existing[key] !== 'object') existing[key] = {};
			mergeTckSpecs(existing[key], newField, fieldPath, conflicts);
		}
	}
}

// ── Notion ────────────────────────────────────────────────────────────────────

async function notionLookupEmployer(edrpou, spec, env) {
	try {
		const res = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_TCK_DB_ID}/query`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
			body: JSON.stringify({ filter: { property: 'ЄДРПОУ компанії', rich_text: { equals: edrpou } }, page_size: 1 }),
		});

		const data = await res.json();
		if (!data.results?.length) return;

		const props = data.results[0].properties;
		const get = name => parseNotionProperty(props[name]) || null;

		const address = get('Адреса');
		const phone = get('Телефон');
		const email = get('Email');
		const director_name = get('Директор (підписант)');
		const responsible_person = get('Відповідальна особа');
		const responsible_phone = get('Телефон відповідальної');

		if (address) spec.employer.address = { value: address, source: 'notion', confidence: 'high' };
		if (phone) spec.employer.phone = { value: phone, source: 'notion', confidence: 'high' };
		if (email) spec.employer.email = { value: email, source: 'notion', confidence: 'high' };

		const orderDirector = spec.employer.director_name?.value || null;
		if (director_name) {
			if (orderDirector && !fuzzyDirectorMatch(director_name, orderDirector)) {
				spec.employer._director_mismatch = { notion: director_name, order: orderDirector };
			}
			spec.employer.director_name = { value: director_name, source: 'notion', confidence: 'high' };
		}

		const resolvedDirector = spec.employer.director_name?.value || '';
		if (resolvedDirector && resolvedDirector.trim().split(/\s+/).length < 3) {
			spec.employer._director_no_patronymic = true;
		}

		if (responsible_person) spec.employer.responsible_person = { value: responsible_person, source: 'notion', confidence: 'high' };
		if (responsible_phone) spec.employer.responsible_phone = { value: responsible_phone, source: 'notion', confidence: 'high' };

		spec.employer.source = 'notion';
		spec.employer._notion_page_id = data.results[0].id;
	} catch {
		// silent fail
	}
}

async function notionSaveEmployer(employer, env) {
	try {
		const v = f => { if (!f) return null; if (typeof f === 'string') return f; return (f && f.value) || null; };
		const rich = val => (val ? [{ text: { content: String(val) } }] : []);

		const edrpou = v(employer.edrpou);
		if (!edrpou) return;

		const properties = {
			'Назва компанії': { title: rich(edrpou) },
			'ЄДРПОУ компанії': { rich_text: rich(edrpou) },
		};

		const orgName = v(employer.org_name);
		const address = v(employer.address);
		const phone = v(employer.phone);
		const email = v(employer.email);
		const director = v(employer.director_name);
		const responsible = v(employer.responsible_person);
		const responsiblePhone = v(employer.responsible_phone);

		if (orgName) properties['Назва (парсинг)'] = { rich_text: rich(orgName) };
		if (address) properties['Адреса'] = { rich_text: rich(address) };
		if (phone) properties['Телефон'] = { phone_number: phone || null };
		if (email) properties['Email'] = { rich_text: rich(email) };
		if (director) properties['Директор (підписант)'] = { rich_text: rich(director) };
		if (responsible) properties['Відповідальна особа'] = { rich_text: rich(responsible) };
		if (responsiblePhone) properties['Телефон відповідальної'] = { rich_text: rich(responsiblePhone) };

		await fetch('https://api.notion.com/v1/pages', {
			method: 'POST',
			headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
			body: JSON.stringify({ parent: { database_id: env.NOTION_TCK_DB_ID }, properties }),
		});
	} catch {
		// silent fail
	}
}

async function notionUpdateEmployer(employer, env) {
	try {
		const pageId = employer._notion_page_id;
		if (!pageId) return;

		const v = f => { if (!f) return null; if (typeof f === 'string') return f; return (f && f.value) || null; };
		const isManual = f => f && typeof f === 'object' && f.source === 'manual';
		const rich = val => (val ? [{ text: { content: String(val) } }] : []);

		const fieldMap = [
			[employer.org_name, 'Назва (парсинг)'],
			[employer.address, 'Адреса'],
			[employer.email, 'Email'],
			[employer.director_name, 'Директор (підписант)'],
			[employer.responsible_person, 'Відповідальна особа'],
			[employer.responsible_phone, 'Телефон відповідальної'],
		];

		const properties = {};
		for (const [field, notionProp] of fieldMap) {
			if (isManual(field)) {
				const val = v(field);
				if (val) properties[notionProp] = { rich_text: rich(val) };
			}
		}

		if (isManual(employer.phone)) {
			const ph = v(employer.phone);
			if (ph) properties['Телефон'] = { phone_number: ph };
		}

		if (!Object.keys(properties).length) return;

		await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
			body: JSON.stringify({ properties }),
		});
	} catch {
		// silent fail
	}
}

async function searchTckAddress(tckName, env) {
	let shortName = tckName;
	if (tckName.length > 60) {
		const m = tckName.match(/([А-ЯҐЄІЇа-яґєії\w'\-]+\s+районний[\s\S]*?центр комплектування)/i);
		shortName = m ? m[1] : tckName.split(/\s+/).slice(0, 5).join(' ');
	}
	const query = `"${shortName}" ТЦК адреса Київ 2025`;

	const messages = [{ role: 'user', content: `Знайди актуальну адресу: ${query}. Поверни ТІЛЬКИ JSON:\n{"address": "повна адреса або null", "alternatives": ["інші варіанти якщо знайдено більше одного"], "status": "found|not_found|multiple_found"}` }];

	let finalText = null;

	for (let i = 0; i < 8; i++) {
		const res = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-api-key': env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05' },
			body: JSON.stringify({
				model: 'claude-haiku-4-5-20251001',
				max_tokens: 1024,
				tools: [{ type: 'web_search_20250305', name: 'web_search' }],
				system: 'Відповідай ТІЛЬКИ валідним JSON без тексту до або після.',
				messages,
			}),
		});

		const data = await res.json();
		if (data.error) break;

		if (data.stop_reason === 'end_turn') {
			finalText = data.content?.find(b => b.type === 'text')?.text ?? null;
			break;
		}

		if (data.stop_reason === 'tool_use') {
			messages.push({ role: 'assistant', content: data.content });
			const toolResults = data.content
				.filter(b => b.type === 'tool_use')
				.map(b => ({ type: 'tool_result', tool_use_id: b.id, content: b.content ?? '' }));
			if (!toolResults.length) break;
			messages.push({ role: 'user', content: toolResults });
		} else {
			finalText = data.content?.find(b => b.type === 'text')?.text ?? null;
			break;
		}
	}

	if (!finalText) return { address: { value: null, source: null, confidence: 'low' }, alternatives: [], status: 'error' };

	try {
		const clean = finalText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
		const match = clean.match(/\{[\s\S]*\}/);
		const parsed = match ? JSON.parse(match[0]) : null;
		if (!parsed || !parsed.address) return { address: { value: null, source: null, confidence: 'low' }, alternatives: [], status: 'not_found' };

		const primaryObj = { value: parsed.address, source: 'web', confidence: 'medium' };
		const otherAlts = (parsed.alternatives || []).filter(a => a && a !== parsed.address).map(a => ({ value: a, source: 'web', confidence: 'medium' }));
		const allAlts = otherAlts.length > 0 ? [primaryObj, ...otherAlts] : [];
		const status = otherAlts.length > 0 ? 'multiple_found' : 'found';
		return { address: { value: parsed.address, source: 'web', confidence: 'medium' }, alternatives: allAlts, status: parsed.status || status };
	} catch {
		return { address: { value: null, source: null, confidence: 'low' }, alternatives: [], status: 'not_found' };
	}
}

async function aiNormalizeDirectorName(nameStr, env) {
	if (!nameStr || nameStr.trim().split(/\s+/).length < 2) return nameStr;
	try {
		const res = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: { 'x-api-key': env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
			body: JSON.stringify({
				model: 'claude-haiku-4-5-20251001',
				max_tokens: 80,
				messages: [{ role: 'user', content: `Визнач прізвище, ім'я та по-батькові: "${nameStr}"\nJSON тільки: {"surname":"...","first_name":"...","patronymic":"..."}\nПо-батькові закінчується на -ович/-евич/-євич/-овна/-евна/-євна.` }],
			}),
		});
		const data = await res.json();
		const text = data.content?.[0]?.text?.trim() ?? '';
		const m = text.match(/\{[^}]+\}/);
		if (!m) return nameStr;
		const p = JSON.parse(m[0]);
		if (p.surname && p.first_name) {
			return [p.surname, p.first_name, p.patronymic].filter(Boolean).join(' ');
		}
	} catch {
		/* silent */
	}
	return nameStr;
}

// ── TCK_EXTRACT_PROMPT ────────────────────────────────────────────────────────

const TCK_EXTRACT_PROMPT = `Витягни дані з наданих документів. Поверни JSON у такій структурі (підстав реальні значення):

{
  "employee": {
    "full_name": {"value": "Прізвище Ім'я По-батькові", "source": "file.pdf", "confidence": "high"},
    "full_name_genitive": {"value": "Прізвище Ім'я По-батькові у родовому відмінку", "source": "наказ.pdf", "confidence": "high"},
    "rnokpp": {"value": "1234567890", "source": "file.pdf", "confidence": "high"},
    "dob": {"value": "DD.MM.YYYY", "source": "file.pdf", "confidence": "high"},
    "address": {"value": "...", "source": "file.pdf", "confidence": "high"},
    "phone": {"value": "...", "source": "file.pdf", "confidence": "medium"}
  },
  "employer": {
    "org_name": {"value": "...", "source": "наказ.pdf", "confidence": "high"},
    "org_name_short": {"value": "ТОВ «НАЗВА»", "source": "наказ.pdf", "confidence": "high"},
    "edrpou": {"value": "12345678", "source": "наказ.pdf", "confidence": "high"},
    "address": {"value": null, "source": null, "confidence": "low"},
    "phone": {"value": null, "source": null, "confidence": "low"},
    "email": {"value": null, "source": null, "confidence": "low"},
    "director_name": {"value": "Прізвище Ім'я По-батькові", "source": "наказ.pdf", "confidence": "high"},
    "responsible_person": {"value": null, "source": null, "confidence": "low"},
    "responsible_phone": {"value": null, "source": null, "confidence": "low"},
    "source": "order"
  },
  "military": {
    "doc_type": {"value": "тип документу", "source": "військ.pdf", "confidence": "high"},
    "vos": {"value": "956647", "source": "військ.pdf", "confidence": "high"},
    "vos_description": {"value": "опис спеціальності або null", "source": "військ.pdf", "confidence": "medium"},
    "number": {"value": "...", "source": "військ.pdf", "confidence": "high"},
    "doc_date": {"value": "DD.MM.YYYY", "source": "військ.pdf", "confidence": "high"},
    "issued_date": {"value": "DD.MM.YYYY", "source": "військ.pdf", "confidence": "medium"},
    "tck_name": {"value": "повна назва ТЦК з документу", "source": "військ.pdf", "confidence": "high"},
    "category": {"value": "...", "source": "військ.pdf", "confidence": "medium"},
    "rank": {"value": "...", "source": "військ.pdf", "confidence": "medium"}
  },
  "tck": {
    "name": {"value": "назва ТЦК", "source": "військ.pdf", "confidence": "high"},
    "name_locative": {"value": "назва ТЦК у місцевому відмінку (де? в/у ...)", "source": "наказ.pdf", "confidence": "medium"},
    "address": {"value": null, "source": null, "confidence": "low"},
    "address_alternatives": [],
    "search_status": "not_searched"
  },
  "order": {
    "number": {"value": "...", "source": "наказ.pdf", "confidence": "high"},
    "date": {"value": "DD.MM.YYYY", "source": "наказ.pdf", "confidence": "high"},
    "type": {"value": "прийняття або звільнення", "source": "наказ.pdf", "confidence": "high"},
    "event_date": {"value": "DD.MM.YYYY", "source": "наказ.pdf", "confidence": "high"},
    "position": {"value": "посада у називному відмінку", "source": "наказ.pdf", "confidence": "high"}
  }
}

Правила:
- full_name ЗАВЖДИ: "Прізвище Ім'я По-батькові"
- employee.full_name_genitive: ПІБ у родовому відмінку (Кого? Чого?)
- employer.org_name_short: скорочена форма назви організації з лапками-ялинками
- military.number: номер документу Обeріг (довгий числовий номер)
- military.vos: числовий ВОС-код. Тільки сам код без тексту
- military.vos_description: текстовий опис спеціальності після ВОС-коду. Може бути null
- military.doc_date: значення поля "Сформовано" = дата генерації документу Обeріг (DD.MM.YYYY)
- military.issued_date: значення поля "Дата уточнення даних" з документу Обeріг (DD.MM.YYYY)
- military.rank: ТІЛЬКИ військове звання. НЕ включати ВОС-код
- employer.director_name: 'Прізвище Ім'я По-батькові' — прізвище першим словом
- tck.name = military.tck_name
- tck.name_locative: візьми tck.name і постав у місцевий відмінок. source: "generated"
- order.type: ТІЛЬКИ "прийняття" або "звільнення"
- order.event_date: дата події З ТЕКСТУ наказу (дата прийняття/звільнення), НЕ дата самого наказу
- confidence: high = дані явно присутні, medium = логічно виведено, low = відсутні`;

// ── Route handlers ────────────────────────────────────────────────────────────

export async function tckParse(request, env, cors) {
	const formData = await request.formData();
	const files = [];

	for (const [_key, file] of formData.entries()) {
		if (!(file instanceof File)) continue;
		const ext = file.name.split('.').pop().toLowerCase();
		if (['pdf', 'docx', 'jpg', 'jpeg', 'png'].includes(ext)) files.push(file);
	}

	if (files.length === 0) return json({ spec: buildEmptyTckSpec() }, cors);

	const contentBlocks = [];
	const fileLabels = [];
	let hasPdf = false;
	let needsSonnet = false;

	for (const file of files) {
		const ext = file.name.split('.').pop().toLowerCase();
		const docType = detectTckDocType(file.name);
		fileLabels.push(`"${file.name}" (${docType})`);
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

	contentBlocks.push({ type: 'text', text: `Файли: ${fileLabels.join(', ')}.\n\n${TCK_EXTRACT_PROMPT}` });

	const parseModel = needsSonnet ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
	const claudeHeaders = { 'Content-Type': 'application/json', 'x-api-key': env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' };
	if (hasPdf) claudeHeaders['anthropic-beta'] = 'pdfs-2024-09-25';

	const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: claudeHeaders,
		body: JSON.stringify({
			model: parseModel,
			max_tokens: 4096,
			system: `Ти — document extraction agent для повідомлення в ТЦК. Відповідай ТІЛЬКИ валідним JSON без тексту до або після.`,
			messages: [{ role: 'user', content: contentBlocks }],
		}),
	});

	const claudeData = await claudeRes.json();
	if (claudeData.error) return json({ error: claudeData.error.message, spec: buildEmptyTckSpec() }, cors, 500);

	const raw = claudeData.content?.[0]?.text ?? '{}';
	let spec;
	try {
		const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
		const match = clean.match(/\{[\s\S]*\}/);
		spec = match ? JSON.parse(match[0]) : buildEmptyTckSpec();
	} catch {
		spec = buildEmptyTckSpec();
	}

	normalizePib(spec.employer?.director_name);
	normalizePib(spec.employee?.full_name);

	if (!spec.tck?.name?.value && spec.military?.tck_name?.value) {
		spec.tck.name = { ...spec.military.tck_name };
	}
	if (!spec.tck?.name?.value) {
		spec.tck.search_status = 'skipped_no_name';
	}

	const tckName = spec?.tck?.name?.value;
	if (tckName) {
		const tckSearch = await searchTckAddress(tckName, env);
		spec.tck.address = tckSearch.address;
		spec.tck.address_alternatives = tckSearch.alternatives;
		spec.tck.search_status = tckSearch.status;
	}

	const edrpou = spec?.employer?.edrpou?.value;
	if (edrpou && env.NOTION_TCK_DB_ID) {
		await notionLookupEmployer(edrpou, spec, env);
	}

	return json({ spec }, cors);
}

export async function tckReparse(request, env, cors) {
	const formData = await request.formData();
	const specRaw = formData.get('spec');
	const file = formData.get('new_file') instanceof File ? formData.get('new_file') : null;

	if (!specRaw || !file) return json({ error: 'spec and new_file required' }, cors, 400);

	let existingSpec;
	try {
		existingSpec = JSON.parse(specRaw);
	} catch {
		return json({ error: 'invalid spec JSON' }, cors, 400);
	}

	const ext = file.name.split('.').pop().toLowerCase();
	if (!['pdf', 'docx', 'jpg', 'jpeg', 'png'].includes(ext)) return json({ error: 'unsupported file type' }, cors, 400);

	const docType = detectTckDocType(file.name);
	const buffer = await file.arrayBuffer();
	const contentBlocks = [];
	let hasPdf = false;

	if (ext === 'pdf') {
		hasPdf = true;
		contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: arrayBufferToBase64(buffer) }, title: file.name });
	} else if (ext === 'docx') {
		const text = await extractDocxText(buffer);
		if (text.length >= 20) contentBlocks.push({ type: 'text', text: `=== ${file.name} ===\n${text}` });
	} else {
		const mediaType = ext === 'png' ? 'image/png' : 'image/jpeg';
		contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: arrayBufferToBase64(buffer) } });
	}

	contentBlocks.push({ type: 'text', text: `Файл: "${file.name}" (${docType}).\n\n${TCK_EXTRACT_PROMPT}` });

	const claudeHeaders = { 'Content-Type': 'application/json', 'x-api-key': env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' };
	if (hasPdf) claudeHeaders['anthropic-beta'] = 'pdfs-2024-09-25';

	const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: claudeHeaders,
		body: JSON.stringify({
			model: 'claude-sonnet-4-6',
			max_tokens: 4096,
			system: `Ти — document extraction agent для повідомлення в ТЦК. Відповідай ТІЛЬКИ валідним JSON без тексту до або після.`,
			messages: [{ role: 'user', content: contentBlocks }],
		}),
	});

	const claudeData = await claudeRes.json();
	if (claudeData.error) return json({ error: claudeData.error.message }, cors, 500);

	const raw = claudeData.content?.[0]?.text ?? '{}';
	let newSpec;
	try {
		const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
		const match = clean.match(/\{[\s\S]*\}/);
		newSpec = match ? JSON.parse(match[0]) : null;
	} catch {
		newSpec = null;
	}

	if (!newSpec) return json({ error: 'extraction failed' }, cors, 500);

	const conflicts = [];
	mergeTckSpecs(existingSpec, newSpec, '', conflicts);

	return json({ spec: existingSpec, conflicts }, cors);
}

export async function handleTckGenerate(request, env, cors) {
	const body = await request.json();
	const spec = body && body.spec ? body.spec : body;

	if (!spec || typeof spec !== 'object') {
		return json({ error: 'invalid_spec' }, cors, 400);
	}

	const dirField = spec.employer?.director_name;
	if (dirField?.value) {
		dirField.value = await aiNormalizeDirectorName(dirField.value, env);
	}

	let result;
	try {
		const resp = await fetch(env.APPS_SCRIPT_TCK_URL, {
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

	if (spec.employer && spec.employer.source !== 'notion') {
		const edrpouVal = spec.employer.edrpou;
		const hasEdrpou = edrpouVal && (typeof edrpouVal === 'string' ? edrpouVal : edrpouVal.value);
		if (hasEdrpou) await notionSaveEmployer(spec.employer, env);
	}

	if (spec.employer && spec.employer.source === 'notion' && spec.employer._notion_page_id) {
		await notionUpdateEmployer(spec.employer, env);
	}

	return json({ ok: true, cover_letter_id: result.cover_letter_id, cover_letter_link: result.cover_letter_link, annex_id: result.annex_id, annex_link: result.annex_link }, cors);
}
