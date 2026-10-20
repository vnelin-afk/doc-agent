import * as XLSX from 'xlsx';

// ── СПИСОК ЗАРПЛАТИ (вхідний файл бухгалтерії) → список одержувачів ────────────
//
// Джерело — нерівна таблиця (розділи по "аркушах друку" з повторюваними шапками,
// підсумкові рядки "Всього по аркушу"/"Разом", підписи). Валідний рядок даних
// визначається двома ознаками одночасно (mapping.md):
//   - колонка A (0-idx 0): № з/п — фактичне число (не текст "1"/"№ з/п")
//   - колонка D (0-idx 3): "Прізвище, ім'я, по батькові, ІПН" — непорожній текст
// Це природно виключає шапки, підзаголовки колонок, підсумки та підписи без
// потреби відрізняти секції/аркуші окремою логікою.

const DOC_NUMBER_DATE_RE = /№\s*(\d+)\s*від\s*(\d{2}\.\d{2}\.\d{4})/;

function isValidDataRow(row) {
	return typeof row[0] === 'number' && String(row[3] ?? '').trim() !== '';
}

function splitNameAndTin(cell) {
	const raw = String(cell ?? '').trim();
	const idx = raw.lastIndexOf(',');
	if (idx === -1) return { name: raw, tin: '' };
	return { name: raw.slice(0, idx).trim(), tin: raw.slice(idx + 1).trim() };
}

export function parseRecipientList(buffer) {
	const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });

	const recipients = [];
	let docNumber = null;
	let docDate = null;

	for (const sheetName of wb.SheetNames) {
		const ws = wb.Sheets[sheetName];
		if (!ws) continue;
		const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

		for (const row of rows) {
			if (!docNumber) {
				const titleCell = row.find(c => typeof c === 'string' && DOC_NUMBER_DATE_RE.test(c));
				if (titleCell) {
					const m = titleCell.match(DOC_NUMBER_DATE_RE);
					docNumber = m[1];
					docDate = m[2];
				}
			}

			if (!isValidDataRow(row)) continue;

			const iban = String(row[2] ?? '').trim();
			if (!iban) continue; // D005: без IBAN — рядок виключається, без валідації формату

			const { name, tin } = splitNameAndTin(row[3]);
			const amount = typeof row[10] === 'number' ? row[10] : parseFloat(String(row[10] ?? '').replace(',', '.'));

			recipients.push({ name, iban, tin, amount: Number.isFinite(amount) ? amount : 0 });
		}
	}

	return { recipients, docNumber, docDate };
}
