import { getGoogleToken } from '../../lib/google.js';
import { arrayBufferToBase64, extractDocxText, normalizeFullName, detectGender, formatShortName, parseNotionProperty } from '../../lib/utils.js';
import { json } from '../../lib/response.js';
import { dedupeEmployees, detectStaffList } from '../timesheet/index.js';

export async function getNotionClient(request, env, cors) {
	const { name } = await request.json();

	const res = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_DB_ID}/query`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.NOTION_TOKEN}`,
			'Notion-Version': '2022-06-28',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			filter: {
				or: [
					{ property: 'Назва компанії', title: { contains: name } },
					{ property: 'ЄДРПОУ компанії', rich_text: { equals: name } },
					{ property: 'Публічна назва', rich_text: { contains: name } },
				],
			},
		}),
	});

	const data = await res.json();
	if (!data.results?.length) return json({ error: 'Client not found' }, cors, 404);

	const page = data.results[0];
	const props = page.properties;
	const client = {
		id: page.id,
		name: props['Назва компанії']?.title?.[0]?.plain_text ?? '',
		edrpou: props['ЄДРПОУ компанії']?.rich_text?.[0]?.plain_text ?? '',
		email: props['Email']?.rich_text?.[0]?.plain_text ?? '',
		director: props['Директор (підписант)']?.rich_text?.[0]?.plain_text ?? '',
		status: props['Status']?.status?.name ?? '',
		drive_folder: props['Папка на диску']?.url ?? '',
	};

	return json({ client }, cors);
}

export async function getDriveTemplates(request, env, cors) {
	const token = await getGoogleToken(env);
	const res = await fetch(
		`https://www.googleapis.com/drive/v3/files?q='${env.TEMPLATES_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
		{ headers: { Authorization: `Bearer ${token}` } },
	);
	const data = await res.json();
	return json({ templates: data.files }, cors);
}

export async function generateDoc(request, env, cors) {
	const { edrpou, templateId, sessionName } = await request.json();
	const token = await getGoogleToken(env);

	const notionRes = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_DB_ID}/query`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.NOTION_TOKEN}`,
			'Notion-Version': '2022-06-28',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ filter: { property: 'ЄДРПОУ компанії', rich_text: { equals: edrpou } } }),
	});
	const notionData = await notionRes.json();
	if (!notionData.results?.length) return json({ error: 'Client not found' }, cors, 404);

	const props = notionData.results[0].properties;
	const client = {};
	for (const [key, value] of Object.entries(props)) {
		client[`{{${key}}}`] = parseNotionProperty(value);
	}

	const today = new Date().toISOString().slice(0, 10);
	const folderName = `${today} ${sessionName || 'Генерація'}`;
	const folderRes = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [env.RESULTS_FOLDER_ID] }),
	});
	const folder = await folderRes.json();

	const docName = `${today}_${edrpou}_${sessionName || 'Документ'}`;
	const copyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${templateId}/copy?supportsAllDrives=true`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: docName, parents: [folder.id] }),
	});
	const doc = await copyRes.json();

	const requests = Object.entries(client).map(([placeholder, value]) => ({
		replaceAllText: { containsText: { text: placeholder, matchCase: true }, replaceText: value },
	}));

	await fetch(`https://docs.googleapis.com/v1/documents/${doc.id}:batchUpdate`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ requests }),
	});

	return json({ docId: doc.id, docName: doc.name, link: `https://docs.google.com/document/d/${doc.id}/edit`, folder: folderName }, cors);
}

export async function handleChat(request, env, cors) {
	const { messages, state } = await request.json();

	const systemPrompt = `Ти — document agent для компанії FinServ. Допомагаєш генерувати документи для клієнтів.

Твої інструменти (викликай через JSON в полі "action"):
- get_client: отримати клієнта з Notion. Параметри: { name: string } — передавай те що написав юзер
- get_templates: отримати список шаблонів з Drive. Без параметрів.
- generate_doc: згенерувати документ. Параметри: { edrpou: string, templateId: string, sessionName: string }
- ask_user: запитати користувача. Параметри: { question: string }
- done: завершити. Параметри: { message: string, link: string }

Поточний стан: ${JSON.stringify(state || {})}

Правила:
1. Якщо запит про генерацію — спочатку виклич get_client, потім get_templates
2. Якщо в стані вже є client і templates — запропонуй юзеру вибрати шаблон зі списку і підтвердити
3. Якщо юзер вибрав шаблон або підтвердив — виклич generate_doc з edrpou клієнта і templateId
4. Після generate_doc виклич done
5. Якщо даних не вистачає — виклич ask_user
6. Відповідай ТІЛЬКИ валідним JSON: { "text": "...", "action": { "type": "...", "params": {...} } }
7. Якщо дія не потрібна — не включай поле action
8. В полі text завжди пиши зрозуміло що відбувається або що потрібно від юзера

КРИТИЧНО: Ти ЗАВЖДИ відповідаєш ТІЛЬКИ валідним JSON об'єктом. Ніякого тексту поза JSON. Ніяких пояснень. Тільки: {"text":"...","action":{...}} або {"text":"..."} якщо дія не потрібна. Якщо потрібно викликати інструмент — обов'язково включай "action".`;

	const res = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'x-api-key': env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
		body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: systemPrompt, messages }),
	});

	const data = await res.json();
	const content = data.content?.[0]?.text ?? '{}';

	let parsed;
	try {
		const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
		parsed = JSON.parse(clean);
	} catch {
		parsed = { text: content };
	}

	return json(parsed, cors);
}

export async function checkDoc(request, env, cors) {
	const { docId } = await request.json();
	const token = await getGoogleToken(env);

	const docRes = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	const doc = await docRes.json();

	const text =
		doc.body?.content
			?.map(b => b.paragraph?.elements?.map(e => e.textRun?.content).join(''))
			.filter(Boolean)
			.join('\n') ?? '';

	const res = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'x-api-key': env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
		body: JSON.stringify({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 512,
			system: 'Ти редактор документів. Перевір документ. Відповідай ТІЛЬКИ валідним JSON без жодного тексту до або після: { "ok": true, "issues": [] } або { "ok": false, "issues": ["опис проблеми"] }',
			messages: [{ role: 'user', content: text }],
		}),
	});

	const data = await res.json();
	const content = data.content?.[0]?.text ?? '{}';
	let parsed;
	try {
		const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
		const jsonMatch = clean.match(/\{[\s\S]*\}/);
		parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { ok: false, issues: [content] };
	} catch {
		parsed = { ok: false, issues: [content] };
	}

	return json(parsed, cors);
}

export async function parseDocPack(request, env, cors) {
	const formData = await request.formData();
	const employees = [];
	let org = null;

	// Спочатку визначаємо, який файл є штатним розписом, щоб не парсити його ще й як наказ
	// (це давало хибний дублікат працівника — штатний розпис не є наказом про прийняття).
	const { staffListFile, positions: staffList } = await detectStaffList(formData, env);

	for (const [_key, file] of formData.entries()) {
		if (!(file instanceof File)) continue;
		if (file === staffListFile) continue;

		const fileName = file.name.toLowerCase();
		const isPdf = fileName.endsWith('.pdf');
		const isDocx = fileName.endsWith('.docx');
		if (!isPdf && !isDocx) continue;

		let claudeMessages;
		let claudeContent;

		if (isPdf) {
			const buffer = await file.arrayBuffer();
			const base64 = arrayBufferToBase64(buffer);
			claudeContent = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }];
			claudeMessages = [{ role: 'user', content: claudeContent }];
		} else {
			const buffer = await file.arrayBuffer();
			claudeContent = await extractDocxText(buffer);
			claudeMessages = [{ role: 'user', content: claudeContent }];
		}

		if (typeof claudeContent === 'string' && claudeContent.length < 20) {
			employees.push({ error: 'empty_content', source_file: file.name });
			continue;
		}

		const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': env.CLAUDE_API_KEY,
				'anthropic-version': '2023-06-01',
				...(isPdf ? { 'anthropic-beta': 'pdfs-2024-09-25' } : {}),
			},
			body: JSON.stringify({
				model: 'claude-haiku-4-5-20251001',
				max_tokens: 1024,
				system: `Витягни дані про працівника з наказу про прийняття на роботу. Відповідай ТІЛЬКИ валідним JSON без тексту до або після:
{
  "full_name": "ПІБ у називному відмінку",
  "position": "посада",
  "start_date": "YYYY-MM-DD",
  "employment_type": "full" або "part",
  "work_days": "all" або ["monday","friday",...],
  "hours_per_day": 8,
  "org_name": "повна назва організації з документу капсом",
  "edrpou": "код ЄДРПОУ",
  "director_name": "ПІБ директора у називному відмінку"
}

Правила:
- position: завжди у називному відмінку, зберігай точний порядок слів як у документі.
- employment_type: "full" якщо основне місце без обмежень; "part" якщо сумісництво або неповний день/тиждень
- work_days: "all" якщо всі робочі дні; масив конкретних днів якщо вказані в наказі
- hours_per_day: (година_кінця - година_початку - 1). Якщо не вказано і full → 8; якщо part → 4
- full_name ЗАВЖДИ у форматі 'Прізвище Ім'я По-батькові'. Завжди повертай: Прізвище першим.`,
				messages: claudeMessages,
			}),
		});

		const claudeData = await claudeRes.json();
		const content = claudeData.content?.[0]?.text ?? '{}';
		try {
			const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
			const parsed = JSON.parse(clean);

			if (!parsed.full_name) {
				employees.push({ error: 'empty_parse', raw: content, source_file: file.name });
				continue;
			}

			parsed.full_name = normalizeFullName(parsed.full_name);

			if (parsed.org_name || parsed.edrpou || parsed.director_name) {
				if (!org) org = { org_name: '', edrpou: '', director_name: '' };
				if (!org.org_name && parsed.org_name) org.org_name = parsed.org_name;
				if (!org.edrpou && parsed.edrpou) org.edrpou = parsed.edrpou;
				if (!org.director_name && parsed.director_name) org.director_name = parsed.director_name;
			}

			const gender = detectGender(parsed.full_name);
			const name_short = formatShortName(parsed.full_name, parsed.position);

			employees.push({
				full_name: parsed.full_name,
				position: parsed.position,
				start_date: parsed.start_date,
				employment_type: parsed.employment_type,
				work_days: parsed.work_days,
				hours_per_day: parsed.hours_per_day,
				gender,
				name_short,
			});
		} catch {
			employees.push({ error: 'parse_failed', raw: content, source_file: file.name });
		}
	}

	const deduped = dedupeEmployees(employees);
	return json({ employees: deduped, org, staffList, count: deduped.length }, cors);
}

export async function getHistory(request, env, cors) {
	const token = await getGoogleToken(env);
	const folderId = '1G5DbiCGHoFCCCnuny0qrWliyYVN1F_lR';

	const res = await fetch(
		`https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,createdTime,modifiedTime)&orderBy=createdTime+desc&pageSize=20&supportsAllDrives=true&includeItemsFromAllDrives=true`,
		{ headers: { Authorization: `Bearer ${token}` } },
	);

	const data = await res.json();

	const files = (data.files || []).map(f => ({
		id: f.id,
		name: f.name,
		mimeType: f.mimeType,
		createdTime: f.createdTime,
		link:
			f.mimeType === 'application/vnd.google-apps.document'
				? `https://docs.google.com/document/d/${f.id}/edit`
				: f.mimeType === 'application/vnd.google-apps.spreadsheet'
					? `https://docs.google.com/spreadsheets/d/${f.id}/edit`
					: `https://drive.google.com/file/d/${f.id}/view`,
	}));

	return json({ files }, cors);
}
