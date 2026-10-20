// ── File helpers ─────────────────────────────────────────────────────────────

export function arrayBufferToBase64(buffer) {
	const bytes = new Uint8Array(buffer);
	const chunks = [];
	const chunkSize = 8192;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		chunks.push(String.fromCharCode(...bytes.slice(i, i + chunkSize)));
	}
	return btoa(chunks.join(''));
}

function decodeXmlEntities(str) {
	return str
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/&apos;/g, "'")
		.replace(/&quot;/g, '"');
}

function decodeDocxPart(xmlBytes) {
	if (!xmlBytes) return '';

	let xmlContent = new TextDecoder('utf-8').decode(xmlBytes);
	if (!/[а-яА-ЯіІїЇєЄ]/.test(xmlContent)) {
		xmlContent = new TextDecoder('windows-1251').decode(xmlBytes);
	}

	const matches = xmlContent.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g);
	const text = decodeXmlEntities([...matches].map(m => m[1]).join(' '));

	return text.replace(/\s+/g, ' ').trim();
}

// Реквізити (ЄДРПОУ, назва організації) часто лежать у колонтитулах шапки/футера,
// а не в тілі документа — тому читаємо header*.xml/footer*.xml теж, якщо вони є.
const DOCX_PARTS = [
	'word/header1.xml',
	'word/header2.xml',
	'word/header3.xml',
	'word/document.xml',
	'word/footer1.xml',
	'word/footer2.xml',
	'word/footer3.xml',
];

export async function extractDocxText(arrayBuffer) {
	const bytes = new Uint8Array(arrayBuffer);
	const parts = [];

	for (const path of DOCX_PARTS) {
		try {
			const xmlBytes = await unzipFile(bytes, path);
			const text = decodeDocxPart(xmlBytes);
			if (text) parts.push(text);
		} catch (e) {
			if (path === 'word/document.xml') {
				console.error('unzipFile error:', e.message);
				return '';
			}
		}
	}

	return parts.join('\n');
}

export async function unzipFile(bytes, targetPath) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	let eocdOffset = -1;
	for (let i = bytes.length - 22; i >= 0; i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocdOffset = i;
			break;
		}
	}
	if (eocdOffset === -1) return null;

	const cdOffset = view.getUint32(eocdOffset + 16, true);
	const cdSize = view.getUint32(eocdOffset + 12, true);

	let offset = cdOffset;
	while (offset < cdOffset + cdSize) {
		const sig = view.getUint32(offset, true);
		if (sig !== 0x02014b50) break;

		const cdFlags = view.getUint16(offset + 8, true);
		const compMethod = view.getUint16(offset + 10, true);
		const compSize = view.getUint32(offset + 20, true);
		const nameLen = view.getUint16(offset + 28, true);
		const extraLen = view.getUint16(offset + 30, true);
		const commentLen = view.getUint16(offset + 32, true);
		const localOffset = view.getUint32(offset + 42, true);

		const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLen);
		const nameEncoding = cdFlags & 0x800 ? 'utf-8' : 'utf-8';
		const name = new TextDecoder(nameEncoding).decode(nameBytes);

		if (name === targetPath) {
			const localSig = view.getUint32(localOffset, true);
			if (localSig !== 0x04034b50) {
				throw new Error(`Invalid ZIP local file header signature 0x${localSig.toString(16)} at offset ${localOffset}`);
			}

			const localNameLen = view.getUint16(localOffset + 26, true);
			const localExtraLen = view.getUint16(localOffset + 28, true);
			const dataOffset = localOffset + 30 + localNameLen + localExtraLen;
			const compressedData = bytes.slice(dataOffset, dataOffset + compSize);

			if (compMethod === 0) {
				return compressedData;
			} else if (compMethod === 8) {
				const ds = new DecompressionStream('deflate-raw');
				const writer = ds.writable.getWriter();
				const reader = ds.readable.getReader();

				writer.write(compressedData);
				writer.close();

				const chunks = [];
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					chunks.push(value);
				}

				const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
				const result = new Uint8Array(totalLength);
				let pos = 0;
				for (const chunk of chunks) {
					result.set(chunk, pos);
					pos += chunk.length;
				}
				return result;
			}
		}

		offset += 46 + nameLen + extraLen + commentLen;
	}

	return null;
}

// ── XLSX штатний розпис ──────────────────────────────────────────────────────
// Офіційний штатний розпис — це таблиця "посада + кількість ставок", БЕЗ ПІБ
// і без ЄДРПОУ (їх там ніколи немає, це завжди береться з наказу). Тому замість
// AI-виклику читаємо клітинки напряму: знаходимо рядок-шапку за заголовками
// "№ п/п" / "Назва посади", далі йдемо вниз, доки є номер у першій колонці.

function parseSharedStrings(bytes) {
	if (!bytes) return [];
	const xml = new TextDecoder('utf-8').decode(bytes);
	const items = [];
	for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
		const texts = [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(t => t[1]);
		items.push(decodeXmlEntities(texts.join('')));
	}
	return items;
}

function parseXlsxSheetRows(xml, sharedStrings) {
	const rows = new Map();
	for (const rm of xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
		const rowNum = parseInt(rm[1], 10);
		const cells = new Map();
		for (const cm of rm[2].matchAll(/<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g)) {
			const attrs = cm[1] ?? cm[2];
			const inner = cm[3] || '';
			const colMatch = attrs.match(/\br="([A-Z]+)\d+"/);
			if (!colMatch) continue;
			const typeMatch = attrs.match(/\bt="([^"]+)"/);
			const type = typeMatch ? typeMatch[1] : 'n';
			let value = '';
			if (type === 's') {
				const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
				value = vMatch ? sharedStrings[parseInt(vMatch[1], 10)] ?? '' : '';
			} else if (type === 'inlineStr') {
				const tMatch = inner.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
				value = tMatch ? decodeXmlEntities(tMatch[1]) : '';
			} else {
				const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
				value = vMatch ? decodeXmlEntities(vMatch[1]) : '';
			}
			cells.set(colMatch[1], value.trim());
		}
		rows.set(rowNum, cells);
	}
	return rows;
}

export async function extractXlsxStaffPositions(arrayBuffer) {
	const bytes = new Uint8Array(arrayBuffer);
	const sheetBytes = await unzipFile(bytes, 'xl/worksheets/sheet1.xml');
	if (!sheetBytes) return [];

	const sharedStrings = parseSharedStrings(await unzipFile(bytes, 'xl/sharedStrings.xml'));
	const sheetXml = new TextDecoder('utf-8').decode(sheetBytes);
	const rows = parseXlsxSheetRows(sheetXml, sharedStrings);

	const rowNums = [...rows.keys()].sort((a, b) => a - b);

	let headerRow = -1;
	let numCol = null;
	let posadaCol = null;
	for (const rn of rowNums) {
		const cells = rows.get(rn);
		let foundNum = null;
		let foundPosada = null;
		for (const [col, val] of cells) {
			if (foundNum === null && /№\s*п\s*\/?\s*п/i.test(val)) foundNum = col;
			if (foundPosada === null && /посад/i.test(val)) foundPosada = col;
		}
		if (foundNum && foundPosada) {
			headerRow = rn;
			numCol = foundNum;
			posadaCol = foundPosada;
			break;
		}
	}
	if (headerRow === -1) return [];

	const positions = [];
	for (const rn of rowNums) {
		if (rn <= headerRow) continue;
		const cells = rows.get(rn);
		const numRaw = (cells.get(numCol) || '').trim();
		const posadaRaw = (cells.get(posadaCol) || '').trim();
		if (!/^\d/.test(numRaw)) break; // "РАЗОМ" чи порожній рядок — кінець таблиці
		const tab_number = numRaw.replace(/\D/g, '');
		if (!tab_number || !posadaRaw) continue;
		positions.push({ tab_number, position: posadaRaw });
	}
	return positions;
}

export function pdfHasTextLayer(buffer) {
	const text = new TextDecoder('latin1').decode(new Uint8Array(buffer));
	const matches = text.match(/\(([^)\x00-\x08\x0e-\x1f]{4,})\)/g) ?? [];
	const extracted = matches.map(m => m.slice(1, -1)).join(' ');
	return extracted.length > 100;
}

// ── Concurrency ───────────────────────────────────────────────────────────────

export async function pLimit(limit, tasks) {
	const results = new Array(tasks.length);
	const executing = new Set();
	for (let i = 0; i < tasks.length; i++) {
		const idx = i;
		const p = Promise.resolve()
			.then(() => tasks[idx]())
			.then(r => {
				results[idx] = r;
			})
			.finally(() => executing.delete(p));
		executing.add(p);
		if (executing.size >= limit) await Promise.race(executing);
	}
	await Promise.all(executing);
	return results;
}

// ── Name / date utilities ─────────────────────────────────────────────────────

export function normalizeFullName(fullName) {
	if (!fullName) return fullName;
	const parts = fullName.trim().split(/\s+/);
	if (parts.length !== 3) return fullName;

	const [a, b, c] = parts;
	const patronymicEndings = ['ович', 'евич', 'євич', 'овна', 'евна', 'євна'];
	const isPatronymic = w => patronymicEndings.some(e => w.toLowerCase().endsWith(e));

	if (isPatronymic(c)) return fullName;
	if (isPatronymic(b)) return `${b} ${a} ${c}`;
	if (isPatronymic(a)) return `${b} ${c} ${a}`;

	const firstNames = new Set([
		'сергій', 'іван', 'роман', 'андрій', 'володимир', 'олег', 'микола', 'василь', 'петро', 'олексій', 'дмитро', 'максим', 'артем',
		'богдан', 'юрій', 'віктор', 'павло', 'михайло', 'ігор', 'євген', 'марія', 'анна', 'олена', 'наталія', 'тетяна', 'юлія', 'ірина',
		'світлана', 'оксана', 'галина', 'валентина', 'надія', 'вікторія', 'катерина', 'аліна', 'дарина',
	]);

	if (firstNames.has(a.toLowerCase()) && !firstNames.has(b.toLowerCase())) {
		return `${b} ${a} ${c}`;
	}

	return fullName;
}

export function detectGender(fullName) {
	if (!fullName) return 'ч';
	const parts = fullName.trim().split(/\s+/);
	const firstName = (parts[1] || '').toLowerCase();
	const patronymic = (parts[2] || '').toLowerCase();

	const femaleNames = [
		'марія', 'анна', 'олена', 'наталія', 'наталя', 'тетяна', 'юлія', 'ірина', 'світлана', 'людмила', 'оксана', 'галина', 'валентина',
		'ніна', 'лариса', 'тамара', 'надія', 'вікторія', 'катерина', 'олеся', 'аліна', 'дарина', 'христина', 'поліна', 'діана', 'софія',
		'ксенія', 'вероніка', 'жанна', 'лілія', 'інна', 'алла', 'зоя', 'єлизавета', 'влада', 'сніжана',
	];

	if (femaleNames.includes(firstName)) return 'ж';
	if (/[вв]на$/.test(patronymic) || /івна$/.test(patronymic) || /ївна$/.test(patronymic)) return 'ж';
	return 'ч';
}

export function formatDirectorName(fullName) {
	if (!fullName) return fullName;
	const parts = fullName.trim().split(/\s+/);
	if (parts.length < 2) return fullName;
	return `${parts[1]} ${parts[0]}`;
}

export function formatShortName(fullName, position) {
	if (!fullName) return '';
	const parts = fullName.trim().split(/\s+/);
	const last = parts[0] || '';
	const firstInitial = parts[1] ? parts[1][0] + '.' : '';
	const patronymicInitial = parts[2] ? parts[2][0] + '.' : '';
	return `${last} ${firstInitial}${patronymicInitial}, ${position || ''}`.trim();
}

export function getWorkingDays(year, month) {
	const days = [];
	const daysInMonth = new Date(year, month, 0).getDate();
	for (let d = 1; d <= daysInMonth; d++) {
		const dow = new Date(year, month - 1, d).getDay();
		if (dow !== 0 && dow !== 6) days.push(d);
	}
	return days;
}

// ── Notion property parser ────────────────────────────────────────────────────

export function parseNotionProperty(prop) {
	if (!prop) return '';
	switch (prop.type) {
		case 'title':
			return prop.title?.[0]?.plain_text ?? '';
		case 'rich_text':
			return prop.rich_text?.[0]?.plain_text ?? '';
		case 'date':
			return prop.date?.start ? new Date(prop.date.start).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
		case 'status':
			return prop.status?.name ?? '';
		case 'select':
			return prop.select?.name ?? '';
		case 'number':
			return prop.number?.toString() ?? '';
		case 'checkbox':
			return prop.checkbox ? 'Так' : 'Ні';
		case 'url':
			return prop.url ?? '';
		case 'email':
			return prop.email ?? '';
		case 'phone_number':
			return prop.phone_number ?? '';
		case 'formula':
			return prop.formula?.string ?? prop.formula?.number?.toString() ?? '';
		case 'rollup':
			return prop.rollup?.array?.[0]?.title?.[0]?.plain_text ?? '';
		case 'people':
			return prop.people?.map(p => p.name).join(', ') ?? '';
		case 'relation':
			return '';
		default:
			return '';
	}
}
