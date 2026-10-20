import { getGoogleToken } from '../../lib/google.js';
import { unzipFile } from '../../lib/utils.js';
import { json } from '../../lib/response.js';

export async function processPayslip(request, env, cors) {
	console.log('processPayslip called');
	const formData = await request.formData();
	const file = formData.get('file');
	if (!file || !(file instanceof File)) {
		return json({ error: 'No file provided' }, cors, 400);
	}

	const buffer = await file.arrayBuffer();
	const bytes = new Uint8Array(buffer);

	function colToIndex(col) {
		let n = 0;
		for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
		return n - 1;
	}

	let allRows;
	try {
		const ssBytes = await unzipFile(bytes, 'xl/sharedStrings.xml');
		const sharedStrings = [];
		if (ssBytes) {
			const xml = new TextDecoder('utf-8').decode(ssBytes);
			for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)) {
				sharedStrings.push(
					m[1]
						.replace(/&amp;/g, '&')
						.replace(/&lt;/g, '<')
						.replace(/&gt;/g, '>')
						.replace(/&apos;/g, "'")
						.replace(/&quot;/g, '"'),
				);
			}
		}

		const sheetBytes = await unzipFile(bytes, 'xl/worksheets/sheet1.xml');
		if (!sheetBytes) return json({ error: 'Cannot read sheet1.xml' }, cors, 400);

		const sheetXml = new TextDecoder('utf-8').decode(sheetBytes);

		let maxCol = 0;
		allRows = [];

		for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
			const rowXml = rowMatch[1];
			const sparse = {};
			for (const cellMatch of rowXml.matchAll(/<c r="([A-Z]+\d+)"(?:[^>]* t="([^"]*)")?[^>]*>([\s\S]*?)<\/c>/g)) {
				const ref = cellMatch[1];
				const type = cellMatch[2] || '';
				const cellXml = cellMatch[3];
				const col = ref.replace(/\d+/g, '');
				const idx = colToIndex(col);
				if (idx > maxCol) maxCol = idx;

				let val = '';
				if (type === 'inlineStr') {
					const m = cellXml.match(/<t[^>]*>([^<]*)<\/t>/);
					val = m ? m[1] : '';
				} else {
					const m = cellXml.match(/<v>([^<]*)<\/v>/);
					if (m) {
						val = m[1];
						if (type === 's') val = sharedStrings[parseInt(val, 10)] ?? '';
					}
				}
				sparse[idx] = val;
			}
			allRows.push(sparse);
		}

		const width = maxCol + 1;
		allRows = allRows.map(sparse => {
			const arr = new Array(width).fill('');
			for (const [i, v] of Object.entries(sparse)) arr[Number(i)] = v;
			return arr;
		});
	} catch (err) {
		return json({ error: 'parse error: ' + err.message }, cors, 500);
	}

	if (!allRows || allRows.length === 0) {
		return json({ error: 'No rows parsed from xlsx' }, cors, 400);
	}

	const token = await getGoogleToken(env);
	const sheetId = env.ECOFACTOR_SHEET_ID;
	const sheetsBase = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
	const sheetsHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

	await fetch(`${sheetsBase}/values/raw:clear`, { method: 'POST', headers: sheetsHeaders });

	const numRows = allRows.length;
	const numCols = allRows[0].length;
	function indexToCol(n) {
		let s = '';
		while (n > 0) {
			n--;
			s = String.fromCharCode(65 + (n % 26)) + s;
			n = Math.floor(n / 26);
		}
		return s;
	}
	const endCol = indexToCol(numCols);
	const range = `raw!A1:${endCol}${numRows}`;

	await fetch(`${sheetsBase}/values:batchUpdate`, {
		method: 'POST',
		headers: sheetsHeaders,
		body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: [{ range, values: allRows }] }),
	});

	await fetch(env.ECOFACTOR_SCRIPT_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({}),
	});

	return json({ ok: true, link: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` }, cors);
}
