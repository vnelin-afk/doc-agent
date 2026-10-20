import { arrayBufferToBase64, extractDocxText, normalizeFullName, formatDirectorName, pLimit } from '../../lib/utils.js';
import { json } from '../../lib/response.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function addUTCMonths(date, months) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function formatVacPeriod(start, end) {
	const p = d => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
	return `${p(start)} - ${p(end)}`;
}

function computeVacationRows(startDateStr, targetYear) {
	const UA_MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];

	if (!startDateStr) return [];
	const start = new Date(startDateStr + 'T00:00:00Z');
	if (isNaN(start.getTime())) return [];

	const startOfYear = new Date(Date.UTC(targetYear, 0, 1));
	const endOfYear = new Date(Date.UTC(targetYear, 11, 31));
	if (start > endOfYear) return [];

	const rows = [];

	for (let wyIndex = 0; ; wyIndex++) {
		if (rows.length >= 2) break;

		const wyStart = new Date(Date.UTC(start.getUTCFullYear() + wyIndex, start.getUTCMonth(), start.getUTCDate()));
		if (wyStart > endOfYear) break;

		const wyEndRaw = new Date(Date.UTC(start.getUTCFullYear() + wyIndex + 1, start.getUTCMonth(), start.getUTCDate()));
		const wyEnd = new Date(wyEndRaw.getTime() - 86400000);
		const work_period = formatVacPeriod(wyStart, wyEnd);

		const row1Start = addUTCMonths(wyStart, 6);
		if (row1Start < startOfYear || row1Start > endOfYear) continue;
		const row1End = new Date(row1Start.getTime() + 13 * 86400000);
		if (row1End > endOfYear) continue;

		rows.push({
			vac_type: 'щорічна основна',
			vac_days: 14,
			vac_month: UA_MONTHS[row1Start.getUTCMonth()],
			period: formatVacPeriod(row1Start, row1End),
			work_period,
		});

		if (rows.length >= 2) break;

		const isStandard = wyEnd <= endOfYear;
		const isAdvance =
			!isStandard &&
			(() => {
				let months =
					(endOfYear.getUTCFullYear() - wyStart.getUTCFullYear()) * 12 + (endOfYear.getUTCMonth() - wyStart.getUTCMonth());
				if (endOfYear.getUTCDate() >= wyStart.getUTCDate()) months += 1;
				return months >= 11;
			})();

		if (!isStandard && !isAdvance) continue;

		let row2Start;
		if (isStandard) {
			row2Start = addUTCMonths(row1End, 2);
		} else {
			row2Start = new Date(Date.UTC(targetYear, 11, 1));
		}

		if (row2Start > endOfYear) continue;
		const row2End = new Date(row2Start.getTime() + 9 * 86400000);

		rows.push({
			vac_type: 'щорічна основна',
			vac_days: 10,
			vac_month: UA_MONTHS[row2Start.getUTCMonth()],
			period: formatVacPeriod(row2Start, row2End),
			work_period,
		});
	}

	return rows;
}

// ── Feature handlers ──────────────────────────────────────────────────────────

async function parseOneVacationFile(file, env, targetYear) {
	const fileName = file.name.toLowerCase();
	const isPdf = fileName.endsWith('.pdf');
	const isDocx = fileName.endsWith('.docx');
	if (!isPdf && !isDocx) return null;

	let claudeContent, claudeMessages;

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
		return { error: 'empty_content', source_file: file.name };
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
			max_tokens: 512,
			system: `Витягни дані з наказу про прийняття на роботу. Відповідай ТІЛЬКИ валідним JSON без тексту до або після:
{
  "full_name": "Прізвище Ім'я По-батькові у називному відмінку",
  "position": "посада у називному відмінку",
  "start_date": "YYYY-MM-DD",
  "org_name": "повна назва організації з документу",
  "director_name": "Прізвище Ім'я По-батькові директора у називному відмінку",
  "edrpou": "код ЄДРПОУ",
  "city": "місто з наказу"
}

Правила:
- full_name ЗАВЖДИ: 'Прізвище Ім'я По-батькові'. Прізвище першим.
- position: у називному відмінку, зберігай порядок слів як у документі
- city: місто де знаходиться організація`,
			messages: claudeMessages,
		}),
	});

	const claudeData = await claudeRes.json();
	const content = claudeData.content?.[0]?.text ?? '{}';
	try {
		const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
		const parsed = JSON.parse(clean);

		if (!parsed.full_name) return { error: 'empty_parse', raw: content, source_file: file.name };

		parsed.full_name = normalizeFullName(parsed.full_name);
		const directorFormatted = formatDirectorName(parsed.director_name || '');
		const vacation_rows = computeVacationRows(parsed.start_date, targetYear);

		return {
			full_name: parsed.full_name,
			position: parsed.position,
			start_date: parsed.start_date,
			org: parsed.org_name || '',
			org_name: parsed.org_name || '',
			director_name: directorFormatted,
			edrpou: parsed.edrpou || '',
			city: parsed.city || '',
			period: vacation_rows[0]?.work_period || '',
			rows: vacation_rows.map(r => ({ type: r.vac_type, days: r.vac_days, month_from: r.vac_month, period: r.period || '' })),
		};
	} catch {
		return { error: 'parse_failed', raw: content, source_file: file.name };
	}
}

export async function vacationParse(request, env, cors) {
	const url = new URL(request.url);
	const targetYear = parseInt(url.searchParams.get('year') || '') || new Date().getFullYear();

	const formData = await request.formData();
	const files = [];
	for (const [, value] of formData.entries()) {
		if (value instanceof File) files.push(value);
	}

	const results = await pLimit(10, files.map(file => () => parseOneVacationFile(file, env, targetYear)));
	const employees = results.filter(Boolean);

	let org = null;
	for (const e of employees) {
		if (!e.error && e.org_name) {
			org = { org_name: e.org_name, director_name: e.director_name, edrpou: e.edrpou, city: e.city };
			break;
		}
	}

	return json({ employees, org }, cors);
}

export async function vacationGenerate(request, env, cors) {
	if (!env.VACATION_SCRIPT_URL) {
		return json({ error: 'VACATION_SCRIPT_URL not configured' }, cors, 500);
	}

	const data = await request.json();
	const { org, director, employees = [] } = data;
	const year = Number(data.year) || new Date().getFullYear();
	const sign_date = data.sign_date || `31.12.${year}`;

	const outEmployees = employees
		.filter(e => e.rows && e.rows.length > 0)
		.map(e => {
			let vr = e.rows.map(r => ({
				vac_type: r.type || 'щорічна основна',
				vac_days: Number(r.days) || 0,
				vac_month: r.monthFrom || '',
				period: r.period || '',
			}));

			if (vr.length === 1 && vr[0].vac_type === 'щорічна основна' && vr[0].vac_days > 14) {
				const r0 = vr[0];
				const remainder = r0.vac_days - 14;
				let period1 = r0.period;
				let period2 = '';

				if (!period1) {
					const UA_MONTHS_GEN = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
					const mi = UA_MONTHS_GEN.indexOf(r0.vac_month);
					if (mi !== -1) {
						const p1s = new Date(Date.UTC(year, mi, 1));
						const p1e = new Date(p1s.getTime() + 13 * 86400000);
						period1 = formatVacPeriod(p1s, p1e);
					}
				}

				if (period1) {
					const endPart = period1.split(' - ')[1];
					if (endPart) {
						const [dd, mm, yyyy] = endPart.split('.').map(Number);
						const p1end = new Date(Date.UTC(yyyy, mm - 1, dd));
						const p2s = new Date(Date.UTC(p1end.getUTCFullYear(), p1end.getUTCMonth() + 2, p1end.getUTCDate()));
						const p2e = new Date(p2s.getTime() + (remainder - 1) * 86400000);
						period2 = formatVacPeriod(p2s, p2e);
					}
				}

				vr = [
					{ vac_type: 'щорічна основна', vac_days: 14, vac_month: r0.vac_month, period: period1 },
					{ vac_type: 'щорічна основна', vac_days: remainder, vac_month: r0.vac_month, period: period2 },
				];
			}

			return {
				full_name: e.name,
				position: e.position,
				rows: [
					{
						vac_type_1: vr[0]?.vac_type || '',
						vac_days_1: vr[0]?.vac_days ?? '',
						vac_month_1: vr[0]?.vac_month || '',
						period_1: vr[0]?.period || '',
						vac_type_2: vr[1]?.vac_type || '',
						vac_days_2: vr[1]?.vac_days ?? '',
						vac_month_2: vr[1]?.vac_month || '',
						period_2: vr[1]?.period || '',
					},
				],
				row_count: vr.length >= 2 ? 2 : 1,
			};
		});

	const payload = { org_name: org, director_name: director, sign_date, city: '', year, employees: outEmployees };

	const scriptRes = await fetch(env.VACATION_SCRIPT_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
		body: JSON.stringify(payload),
	});

	const scriptData = await scriptRes.json();
	return json(scriptData, cors);
}
