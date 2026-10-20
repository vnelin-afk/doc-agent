import { getGoogleToken } from '../../lib/google.js';
import {
	arrayBufferToBase64,
	extractDocxText,
	extractXlsxStaffPositions,
	pdfHasTextLayer,
	normalizeFullName,
	detectGender,
	formatDirectorName,
	formatShortName,
	getWorkingDays,
} from '../../lib/utils.js';
import { json } from '../../lib/response.js';

const PARSE_EMPLOYEE_PROMPT = `Витягни дані про працівника з наказу про прийняття на роботу. Відповідай ТІЛЬКИ валідним JSON без тексту до або після:
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
- full_name ЗАВЖДИ у форматі 'Прізвище Ім'я По-батькові'. Прізвище першим.`;

// Штатний розпис — офіційний документ виду "посада + кількість ставок". У ньому НІКОЛИ немає
// ні ПІБ працівників, ні ЄДРПОУ, ні назви організації — усе це береться виключно з наказу
// про прийняття на роботу (див. PARSE_EMPLOYEE_PROMPT). Тому звідси витягуємо лише
// {position, tab_number} — список посад з їх номером за порядком (№ п/п) у розписі.
export async function parseStaffList(buffer, mimeType, env) {
	if (mimeType === 'xlsx') {
		// xlsx має чітку клітинкову структуру — читаємо деterміновано, без AI.
		const positions = await extractXlsxStaffPositions(buffer);
		return { positions };
	}

	const isPdf = mimeType === 'application/pdf';
	let useSonnet = false;
	let messages;
	const headers = {
		'Content-Type': 'application/json',
		'x-api-key': env.CLAUDE_API_KEY,
		'anthropic-version': '2023-06-01',
	};

	if (isPdf) {
		if (!pdfHasTextLayer(buffer)) useSonnet = true;
		headers['anthropic-beta'] = 'pdfs-2024-09-25';
		messages = [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: arrayBufferToBase64(buffer) } }] }];
	} else {
		const text = await extractDocxText(buffer);
		messages = [{ role: 'user', content: [{ type: 'text', text }] }];
	}

	const res = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers,
		body: JSON.stringify({
			model: useSonnet ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',
			max_tokens: 2048,
			system:
				'Extract data from this штатний розпис (staff list) document as JSON: {"positions": [{"position": "назва посади як у документі", "tab_number": "№ п/п цієї посади в розписі"}]}. Це офіційний штатний розпис — у ньому НЕМАЄ ПІБ працівників, ЄДРПОУ чи назви організації, тільки посади. Return only JSON.',
			messages,
		}),
	});

	const data = await res.json();
	const raw = data.content?.[0]?.text ?? '{}';
	try {
		const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
		const arrMatch = clean.match(/^\s*\[[\s\S]*\]\s*$/);
		if (arrMatch) return { positions: JSON.parse(arrMatch[0]) };
		const objMatch = clean.match(/\{[\s\S]*\}/);
		if (!objMatch) return { positions: [] };
		const parsed = JSON.parse(objMatch[0]);
		return { positions: parsed.positions || [] };
	} catch {
		return { positions: [] };
	}
}

// Штатний розпис визначаємо не лише по tab_number, бо ШІ часом не знаходить цю колонку
// в PDF-експортах з Excel — тоді файл ігнорувався попри коректний парсинг списку посад.
// Довіряємо назві файлу ("штатний розпис ...") або наявності кількох посад одразу.
export function isStaffListMatch(fileName, parsedStaff) {
	const candidates = parsedStaff?.positions || [];
	if (candidates.length === 0) return false;
	if (/штат/i.test(fileName)) return true;
	// Один tab_number/одна посада — занадто слабкий сигнал: наказ теж описує
	// одну посаду ("на посаду директора"), і ШІ регулярно хaлюцинує з нього
	// "штатний розпис" з одним записом, через що наказ хибно пропускався у
	// подальшому парсингу. Довіряємо вмісту лише коли посад декілька одразу.
	return candidates.length > 1;
}

function normalizePosition(s) {
	if (!s) return '';
	return s
		.toLowerCase()
		.replace(/[«»"'()]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

// Спершу шукаємо штатний розпис за назвою файлу (найнадійніший сигнал — сам
// документ ніколи не підписує себе інакше). AI-перевірку вмісту робимо лише
// для файлів, чия назва нічого не підказує, і то лише один раз на пачку —
// щоб не ганяти кожен наказ через зайвий виклик Claude і не ризикувати
// хaлюцинацією "штатного розпису" з одного наказу (див. isStaffListMatch).
export async function detectStaffList(formData, env) {
	for (const [, f] of formData.entries()) {
		if (f instanceof File && /\.(pdf|docx|xlsx)$/i.test(f.name) && /штат/i.test(f.name)) {
			const buf = await f.arrayBuffer();
			const ext = f.name.toLowerCase().split('.').pop();
			const mime = ext === 'pdf' ? 'application/pdf' : ext === 'xlsx' ? 'xlsx' : 'docx';
			const parsedStaff = await parseStaffList(buf, mime, env);
			return { staffListFile: f, positions: parsedStaff.positions || [] };
		}
	}

	for (const [, f] of formData.entries()) {
		if (!(f instanceof File) || !/\.(pdf|docx|xlsx)$/i.test(f.name)) continue;
		const buf = await f.arrayBuffer();
		const ext = f.name.toLowerCase().split('.').pop();
		const mime = ext === 'pdf' ? 'application/pdf' : ext === 'xlsx' ? 'xlsx' : 'docx';
		const parsedStaff = await parseStaffList(buf, mime, env);
		if (isStaffListMatch(f.name, parsedStaff)) {
			return { staffListFile: f, positions: parsedStaff.positions || [] };
		}
	}

	return { staffListFile: null, positions: [] };
}

export function extractNameParts(name) {
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

// Дедуплікація за прізвищем + ініціалами: різні документи пачки (накази, штатний розпис,
// повторно завантажений файл тощо) можуть описувати одну й ту саму людину. Залишаємо перше
// успішно розпізнане входження, наступні збіги відкидаємо. Записи з error не дедуплікуються —
// вони й так не потрапляють у фінальний список, але лишаються видимими для діагностики.
export function dedupeEmployees(employees) {
	const seen = new Set();
	const result = [];
	for (const emp of employees) {
		if (emp.error || !emp.full_name) {
			result.push(emp);
			continue;
		}
		const { surname, firstInitial } = extractNameParts(emp.full_name);
		const key = surname ? `${surname.toLowerCase()}_${firstInitial}` : null;
		if (key && seen.has(key)) continue;
		if (key) seen.add(key);
		result.push(emp);
	}
	return result;
}

// Штатний розпис не має ПІБ — тільки посади. Тому табельний номер шукаємо за
// співпадінням посади з наказу (r.position) з посадою в розписі, а не за іменем.
export function matchTabNumber(position, staffList) {
	if (!staffList || staffList.length === 0 || !position) return null;

	const target = normalizePosition(position);
	if (!target) return null;

	let partial = null;

	for (const entry of staffList) {
		if (!entry.position || !entry.tab_number) continue;
		const cand = normalizePosition(entry.position);
		if (!cand) continue;
		if (cand === target) return parseInt(entry.tab_number, 10).toString();
		if (!partial && (cand.includes(target) || target.includes(cand))) partial = entry;
	}

	return partial ? parseInt(partial.tab_number, 10).toString() : null;
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Рядки табеля у форматі, який приймає Apps Script (spec.employees). Ця ж структура
// повертається на фронт для редагованого перегляду, тому додатково несе full_name/position —
// за ними фронт зберігає порядок і ручні правки при перебудові (зміна місяця, нові файли).
export function buildTimesheetRows({ employees, year, month, exceptions = {}, staffList = [] }) {
	const workingDays = getWorkingDays(year, month);
	const daysInMonth = new Date(year, month, 0).getDate();

	return employees.map((emp, i) => {
		const days = {};
		for (const day of workingDays) {
			const dayName = DAY_NAMES[new Date(year, month - 1, day).getDay()];
			const exKey = `${emp.full_name}_${day}`;

			if (exceptions[exKey]) {
				days[day] = exceptions[exKey];
			} else if (emp.work_days === 'all' || emp.work_days?.includes(dayName)) {
				const code = emp.employment_type === 'full' ? 'Р' : 'РС';
				days[day] = { code, hours: emp.hours_per_day || 8 };
			}
		}

		return recalcRow({
			index: i + 1,
			tabNumber: matchTabNumber(emp.position, staffList) ?? String(i + 1),
			gender: emp.gender || 'ч',
			name: emp.name_short || `${emp.full_name}, ${emp.position}`,
			full_name: emp.full_name,
			position: emp.position,
			days: Array.from({ length: 31 }, (_, d) => {
				const dayNum = d + 1;
				if (dayNum > daysInMonth) return { code: 'Х', hours: '-' };
				const day = days[dayNum];
				return day ? { code: day.code, hours: day.hours } : { code: '-', hours: '-' };
			}),
		});
	});
}

// Підсумки рядка рахуються з комірок днів: день відпрацьований, якщо в ньому числові години.
// Використовується і при побудові, і для відредагованих менеджером рядків — щоб ручні правки
// днів не розходились з колонками "днів/годин".
export function recalcRow(row) {
	let days = 0;
	let hours = 0;
	for (const d of row.days || []) {
		const h = Number(String(d?.hours ?? '').replace(',', '.'));
		if (d?.hours !== '' && d?.hours !== '-' && Number.isFinite(h) && h > 0) {
			days++;
			hours += h;
		}
	}
	return {
		...row,
		summary: {
			overtime: '',
			night: '',
			evening: '',
			weekend: '',
			...row.summary,
			days: String(days),
			hours: String(hours),
			total: String(hours),
		},
	};
}

export function buildTotals(rows) {
	const sum = key => String(rows.reduce((s, r) => s + (Number(r.summary?.[key]) || 0), 0));
	return { days: sum('days'), hours: sum('hours'), total: sum('total'), overtime: '', night: '', evening: '', weekend: '' };
}

// Відредаговані на фронті рядки: порядок масиву = порядок у документі, тому № п/п
// перенумеровуємо, а підсумки перераховуємо з днів (не довіряємо клієнтським summary).
export function normalizeEditedRows(rows) {
	return rows.map((r, i) => recalcRow({ ...r, index: i + 1 }));
}

export async function previewTimesheet(request, env, cors) {
	const { employees = [], year, month, staffList = [] } = await request.json();
	const rows = buildTimesheetRows({ employees, year, month, staffList });
	return json({ rows, total: buildTotals(rows) }, cors);
}

export async function generateTimesheet(request, env, cors) {
	const data = await request.json();
	const { employees, year, month, exceptions = {}, staffList = [] } = data;

	const rows = Array.isArray(data.rows) ? normalizeEditedRows(data.rows) : buildTimesheetRows({ employees, year, month, exceptions, staffList });
	const spec = {
		employees: rows.map(({ full_name, position, ...r }) => r),
		total: buildTotals(rows),
	};

	const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyWwxaqvGLz0qqYgpPJe-BanyI9UNF34tQvsrhGhCjyFqVGIG8hcnKW03B8vq_V63RW/exec';

	const lastDay = new Date(year, month, 0).getDate();
	const lastDayFormatted = `${String(lastDay).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;

	const payload = {
		org_name: data.org_name || data.org?.org_name || env.ORG_NAME || '',
		edrpou: data.edrpou || data.org?.edrpou || '',
		fill_date: data.fill_date || lastDayFormatted,
		period_from: data.period_from || '',
		period_to: data.period_to || '',
		sign_date: data.sign_date || lastDayFormatted,
		director_name: formatDirectorName(data.director_name || data.org?.director_name || ''),
		employees: spec.employees,
		total: spec.total,
	};

	const scriptRes = await fetch(APPS_SCRIPT_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
		body: JSON.stringify(payload),
	});

	const scriptData = await scriptRes.json();
	return json(scriptData, cors);
}

export async function timesheetFromPack(request, env, cors) {
	const formData = await request.formData();

	const year = Number(formData.get('year'));
	const month = Number(formData.get('month'));
	const fill_date = formData.get('fill_date') || '';
	const period_from = formData.get('period_from') || '';
	const period_to = formData.get('period_to') || '';
	const sign_date = formData.get('sign_date') || '';
	const manualOrgName = formData.get('org_name') || '';
	const manualEdrpou = formData.get('edrpou') || '';
	const manualDirectorName = formData.get('director_name') || '';

	const { staffListFile, positions: staffList } = await detectStaffList(formData, env);
	console.log('Staff list:', staffListFile?.name ?? 'not found', 'entries:', staffList.length);
	if (staffList.length === 0) {
		return json({ error: 'Штатний розпис не знайдено. Додайте файл зі штатним розписом.' }, cors, 400);
	}

	const employees = [];
	let org = null;

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
				system: PARSE_EMPLOYEE_PROMPT,
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

	if (manualOrgName || manualEdrpou || manualDirectorName) {
		if (!org) org = { org_name: '', edrpou: '', director_name: '' };
		if (manualOrgName) org.org_name = manualOrgName;
		if (manualEdrpou) org.edrpou = manualEdrpou;
		if (manualDirectorName) org.director_name = manualDirectorName;
	}

	const validEmployees = dedupeEmployees(employees).filter(e => !e.error);
	if (validEmployees.length === 0) {
		return json({ error: 'Жодного наказу про прийняття на роботу не розпізнано. Перевірте завантажені файли.' }, cors, 400);
	}
	const body = JSON.stringify({ employees: validEmployees, org, year, month, fill_date, period_from, period_to, sign_date, staffList });
	const fakeRequest = new Request('https://internal/docs/timesheet', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body,
	});

	return await generateTimesheet(fakeRequest, env, cors);
}

export async function createTimesheetTemplate(request, env, cors) {
	const { companyName, edrpou, periodStart, periodEnd, fillDate, folderId } = await request.json();
	const token = await getGoogleToken(env);
	const BASE_TEMPLATE_ID = '1ls3WmasqXfYqIsprFBQ_CHU9acGAv6oyaKUlUgXhr4Q';

	const copyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${BASE_TEMPLATE_ID}/copy?supportsAllDrives=true`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: `Табель_${companyName}_${periodStart}`, parents: [folderId || env.RESULTS_FOLDER_ID] }),
	});
	const copyData = await copyRes.json();
	const docId = copyData.id;
	if (!docId) return json({ error: 'copy_failed', detail: copyData }, cors, 500);

	const text = [
		'ТАБЕЛЬ ОБЛІКУ ВИКОРИСТАННЯ РОБОЧОГО ЧАСУ\n',
		`${companyName}\n`,
		`Ідентифікаційний код ЄДРПОУ ${edrpou}\n`,
		`Звітний період: ${periodStart} — ${periodEnd}\n`,
		`Дата заповнення: ${fillDate}\n`,
	].join('');

	await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text } }] }),
	});

	return json({ docId, link: `https://docs.google.com/document/d/${docId}/edit` }, cors);
}
