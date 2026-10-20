import * as XLSX from 'xlsx';
import { json } from '../../lib/response.js';
import { getGoogleToken } from '../../lib/google.js';
import { parseRecipientList } from './parser.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function uploadXlsxToDrive(env, bytes, filename) {
	const token = await getGoogleToken(env);
	const boundary = '----doc-agent-' + crypto.randomUUID();
	const metadata = { name: filename, parents: [env.RESULTS_FOLDER_ID], mimeType: XLSX_MIME };
	const enc = new TextEncoder();
	const head = enc.encode(
		`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
			`--${boundary}\r\nContent-Type: ${XLSX_MIME}\r\nContent-Transfer-Encoding: binary\r\n\r\n`,
	);
	const tail = enc.encode(`\r\n--${boundary}--\r\n`);
	const body = new Uint8Array(head.length + bytes.byteLength + tail.length);
	body.set(head, 0);
	body.set(new Uint8Array(bytes), head.length);
	body.set(tail, head.length + bytes.byteLength);

	const upRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
		body,
	});
	const upData = await upRes.json();
	if (!upRes.ok || !upData.id) throw new Error('drive_upload_failed: ' + JSON.stringify(upData));

	await fetch(`https://www.googleapis.com/drive/v3/files/${upData.id}/permissions?supportsAllDrives=true`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ role: 'reader', type: 'anyone' }),
	});

	return upData.id;
}

// Шаблон monobank (6 колонок, D002: "Документ"/"Тип документу" завжди порожні).
const HEADER = ['ПІБ отримувача', 'IBAN отримувача', 'Сума, грн', 'ІПН отримувача', 'Документ', 'Тип документу'];

function buildMonobankWorkbook(recipients) {
	const aoa = [HEADER, ...recipients.map(r => [r.name, r.iban, r.amount, r.tin, '', ''])];
	const ws = XLSX.utils.aoa_to_sheet(aoa);
	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wb, ws, 'Sheet');
	return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

function todayFormatted() {
	const now = new Date();
	const dd = String(now.getDate()).padStart(2, '0');
	const mm = String(now.getMonth() + 1).padStart(2, '0');
	return `${dd}.${mm}.${now.getFullYear()}`;
}

export async function zpVidomistMonobankGenerate(request, env, cors) {
	const formData = await request.formData();
	const file = formData.get('file');
	if (!file || !(file instanceof File)) {
		return json({ error: 'No file provided' }, cors, 400);
	}

	const buffer = await file.arrayBuffer();

	let parsed;
	try {
		parsed = parseRecipientList(buffer);
	} catch (err) {
		return json({ error: 'parse_error', detail: err.message }, cors, 500);
	}

	const { recipients, docNumber, docDate } = parsed;
	if (recipients.length === 0) {
		return json({ error: 'no_valid_recipients' }, cors, 400);
	}

	const bytes = buildMonobankWorkbook(recipients);
	const filename = `ЗП_відомість_monobank_№${docNumber || '1'}_${docDate || todayFormatted()}.xlsx`;

	let fileId;
	try {
		fileId = await uploadXlsxToDrive(env, bytes, filename);
	} catch (err) {
		return json({ error: 'drive_upload_failed', detail: err.message }, cors, 500);
	}

	return json(
		{
			fileId,
			filename,
			count: recipients.length,
			downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
			viewUrl: `https://drive.google.com/file/d/${fileId}/view`,
		},
		cors,
	);
}
