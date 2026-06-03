const COVER_LETTER_TEMPLATE_ID = PropertiesService.getScriptProperties().getProperty('TCK_COVER_LETTER_TEMPLATE');
const ANNEX4_TEMPLATE_ID = PropertiesService.getScriptProperties().getProperty('TCK_ANNEX4_TEMPLATE');
const RESULTS_FOLDER_ID = '1G5DbiCGHoFCCCnuny0qrWliyYVN1F_lR';

function doPost(e) {
	try {
		const data = JSON.parse(e.postData.contents);
		const spec = data.spec || data;
		const coverResult = generateCoverLetter(spec);
		const annex4Result = generateAnnex4(spec);
		return ContentService.createTextOutput(
			JSON.stringify({
				ok: true,
				cover_letter_id: coverResult.id,
				annex_id: annex4Result.id,
				cover_letter_link: coverResult.link,
				annex_link: annex4Result.link,
			})
		).setMimeType(ContentService.MimeType.JSON);
	} catch (err) {
		return ContentService.createTextOutput(
			JSON.stringify({ ok: false, error: err.message })
		).setMimeType(ContentService.MimeType.JSON);
	}
}

function getVal(field) {
	if (!field) return '';
	if (typeof field === 'string') return field;
	if (typeof field === 'object' && field !== null) return String(field.value || '');
	return '';
}

function parseTckAddress(addr) {
	if (!addr) return { city: '', street: '', zip: '' };
	// split by comma or newline, strip empty and "індекс" segments
	const parts = addr.split(/[\n\r,]+/)
		.map(s => s.trim())
		.filter(s => s && !/\bіндекс\b/i.test(s));
	// extract 5-digit zip from any segment
	let zip = '';
	const remaining = [];
	for (const part of parts) {
		const zm = part.match(/\b(\d{5})\b/);
		if (!zip && zm) {
			zip = zm[1];
			const cleaned = part.replace(/\b\d{5}\b/, '').trim().replace(/^[,\s]+|[,\s]+$/g, '');
			if (cleaned) remaining.push(cleaned);
		} else {
			remaining.push(part);
		}
	}
	const cityPrefixes = ['м.', 'с.', 'смт.'];
	const cityIdx = remaining.findIndex(p => cityPrefixes.some(pref => p.startsWith(pref)));
	let city = '';
	let street = '';
	if (cityIdx !== -1) {
		city = remaining[cityIdx];
		street = remaining.filter((_, i) => i !== cityIdx).join(', ');
	} else {
		street = remaining.join(', ');
	}
	return { city, street, zip };
}

function getOrgNameGenitive(orgName) {
	if (!orgName) return '';
	const name = orgName.trim();
	if (/^ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ/i.test(name))
		return name.replace(/^ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ/i, 'Товариства з обмеженою відповідальністю');
	if (/^ПРИВАТНЕ ПІДПРИЄМСТВО/i.test(name))
		return name.replace(/^ПРИВАТНЕ ПІДПРИЄМСТВО/i, 'Приватного підприємства');
	if (/^АКЦІОНЕРНЕ ТОВАРИСТВО/i.test(name))
		return name.replace(/^АКЦІОНЕРНЕ ТОВАРИСТВО/i, 'Акціонерного товариства');
	if (/^ФІЗИЧНА ОСОБА[\s\-–]+ПІДПРИЄМЕЦЬ/i.test(name))
		return name.replace(/^ФІЗИЧНА ОСОБА[\s\-–]+ПІДПРИЄМЕЦЬ/i, 'Фізичної особи-підприємця');
	return name;
}

function stripIndexLine(addr) {
	if (!addr) return '';
	return addr.split(/[\n\r,]+/)
		.map(s => s.trim())
		.filter(s => s && !/\bіндекс\b/i.test(s))
		.join(', ');
}

function toOrgSentenceCase(str) {
	if (!str) return '';
	const lower = str.toLowerCase();
	let result = lower.charAt(0).toUpperCase() + lower.slice(1);
	result = result.replace(/«([а-яґєіїa-z])/gi, (_, c) => '«' + c.toUpperCase());
	return result;
}

function getShortOrgName(fullName) {
	if (!fullName) return '';
	const replacements = [
		['ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ', 'ТОВ'],
		['ПРИВАТНЕ ПІДПРИЄМСТВО', 'ПП'],
		['ФІЗИЧНА ОСОБА-ПІДПРИЄМЕЦЬ', 'ФОП'],
		['АКЦІОНЕРНЕ ТОВАРИСТВО', 'АТ'],
	];
	for (const [full, short] of replacements) {
		if (fullName.includes(full)) {
			return fullName.replace(full, short).trim();
		}
	}
	return fullName;
}

// Суфікси прізвищ для визначення порядку слів
function _looksLikeSurname(word) {
	return /ська$|ський$|зька$|зький$|цька$|цький$|енко$|чук$|ець$|юк$|ук$|ій$|ій$|ова$|ева$|ів$|єв$|ин$|их$/i.test(word);
}

// Нормалізує до порядку "Прізвище Ім'я По-батькові"
// Якщо вхід "Ім'я По-батькові Прізвище" — переставляє прізвище на перше місце
function _normalizeSurnameFirst(fullName) {
	if (!fullName) return '';
	const parts = fullName.trim().split(/\s+/);
	if (parts.length !== 3) return fullName.trim();
	if (!_looksLikeSurname(parts[0]) && _looksLikeSurname(parts[2])) {
		return `${parts[2]} ${parts[0]} ${parts[1]}`;
	}
	return fullName.trim();
}

// Формат для Додатку 4: "І.Ю.Білецька" (ініціали + прізвище повністю)
function formatToInitials(fullName) {
	if (!fullName) return '';
	const normalized = _normalizeSurnameFirst(fullName);
	const parts = normalized.split(/\s+/);
	if (parts.length === 1) return parts[0][0].toUpperCase() + parts[0].slice(1).toLowerCase();
	const surname = parts[0][0].toUpperCase() + parts[0].slice(1).toLowerCase();
	const initials = parts.slice(1).map(p => p[0].toUpperCase() + '.').join('');
	return initials + surname;
}

// Формат для Супровідного листа: "Ім'я ПРІЗВИЩЕ"
function formatDirectorCoverLetter(fullName) {
	if (!fullName) return '';
	const normalized = _normalizeSurnameFirst(fullName);
	const parts = normalized.split(/\s+/);
	if (parts.length === 1) return parts[0].toUpperCase();
	const surname = parts[0].toUpperCase();
	const firstName = parts[1][0].toUpperCase() + parts[1].slice(1).toLowerCase();
	return `${firstName} ${surname}`;
}

function formatDateUA(dateStr) {
	if (!dateStr) return '';
	const months = ['', 'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
		'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
	const m = dateStr.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})$/);
	if (!m) return dateStr;
	return `${parseInt(m[1])} ${months[parseInt(m[2])] || m[2]} ${m[3]}`;
}

function fillTemplate(templateId, fileName, replacements) {
	console.log('fillTemplate called, templateId:', templateId);
	console.log('replacements:', JSON.stringify(replacements));
	const copy = DriveApp.getFileById(templateId).makeCopy(fileName, DriveApp.getFolderById(RESULTS_FOLDER_ID));
	const doc = DocumentApp.openById(copy.getId());
	const body = doc.getBody();
	for (const [placeholder, value] of Object.entries(replacements)) {
		body.replaceText('\\{\\{' + placeholder + '\\}\\}', String(value || ''));
	}
	doc.saveAndClose();
	return { id: copy.getId(), link: copy.getUrl() };
}

function generateCoverLetter(spec) {
	console.log('=== generateCoverLetter ===');
	console.log('spec keys:', JSON.stringify(Object.keys(spec || {})));
	console.log('employer:', JSON.stringify(spec?.employer?.org_name));
	console.log('employee:', JSON.stringify(spec?.employee?.full_name));
	console.log('tck:', JSON.stringify(spec?.tck?.name));
	console.log('templateId:', COVER_LETTER_TEMPLATE_ID);
	const employer = spec.employer || {};
	const tck = spec.tck || {};
	const employee = spec.employee || {};
	const order = spec.order || {};
	const orgName = getVal(employer.org_name);
	// FIX-11: скорочена назва з spec якщо є, інакше авто-скорочення
	const orgNameShort = getVal(employer.org_name_short) || getShortOrgName(orgName);
	const tckAddr = parseTckAddress(getVal(tck.address));
	const today = Utilities.formatDate(new Date(), 'Europe/Kyiv', 'dd.MM.yyyy');
	const employeeFullName = getVal(employee.full_name);
	const fileName = `Супровідний лист — ${employeeFullName} — ${today}`;
	// FIX-10: тип зміни ("прийняття" / "звільнення")
	const changeType = getVal(order.type) || 'прийняття';
	const replacements = {
		// FIX-11: повна назва великими літерами
		EMPLOYER_NAME_FULL: orgName.toUpperCase(),
		EMPLOYER_NAME_SHORT: orgNameShort,
		EMPLOYER_CITY: stripIndexLine(getVal(employer.address)),
		EMPLOYER_PHONE: getVal(employer.phone),
		EMPLOYER_EMAIL: getVal(employer.email),
		EMPLOYER_EDRPOU: getVal(employer.edrpou),
		TCK_NAME: getVal(tck.name),
		TCK_CITY: tckAddr.city,
		TCK_ADDRESS: tckAddr.street,
		TCK_ZIP: tckAddr.zip,
		// FIX-15: назва ТЦК у місцевому відмінку
		TCK_NAME_LOCATIVE: getVal(tck.name_locative),
		// FIX-12: ПІБ у родовому відмінку
		EMPLOYEE_NAME_GENITIVE: getVal(employee.full_name_genitive) || employeeFullName,
		// FIX-13: директор у форматі "Ім'я ПРІЗВИЩЕ" для cover letter
		DIRECTOR_NAME: formatDirectorCoverLetter(getVal(employer.director_name)),
		// FIX-14: відповідальна особа та телефон
		RESPONSIBLE_NAME: getVal(employer.responsible_person),
		RESPONSIBLE_PHONE: getVal(employer.responsible_phone) || getVal(employer.phone),
		// FIX-10: тип зміни
		CHANGE_TYPE_UA: changeType === 'звільнення' ? changeType : 'прийняття на роботу',
	};
	const coverResult = fillTemplate(COVER_LETTER_TEMPLATE_ID, fileName, replacements);
	console.log('fillTemplate result:', JSON.stringify(coverResult));
	return coverResult;
}

function getTckShortName(fullName) {
	if (!fullName) return '';
	return fullName.replace(/територіальний центр комплектування та соціальної підтримки/gi, 'ТЦК та СП').trim();
}

function generateAnnex4(spec) {
	const employer = spec.employer || {};
	const employee = spec.employee || {};
	const military = spec.military || {};
	const order = spec.order || {};
	const tck = spec.tck || {};
	const today = Utilities.formatDate(new Date(), 'Europe/Kyiv', 'dd.MM.yyyy');
	const employeeFullName = getVal(employee.full_name);
	const orgName = getVal(employer.org_name);
	// FIX-11: скорочена назва з spec якщо є, інакше авто-скорочення
	const orgNameShort = getVal(employer.org_name_short) || getShortOrgName(orgName);
	const orderDate = getVal(order.date);
	// FIX-10: тип зміни та дата події
	const changeType = getVal(order.type) || 'прийняття';
	const eventDate = getVal(order.event_date) || orderDate;
	const changeTypePast = changeType === 'звільнення' ? 'звільнений' : 'прийнятий';
	const fileName = `Додаток 4 — ${employeeFullName} — ${today}`;
	const replacements = {
		TCK_NAME: getVal(tck.name),
		TCK_NAME_SHORT: getTckShortName(getVal(tck.name)),
		EMPLOYEE_FULL_NAME: employeeFullName,
		// FIX-8: номер Обeріг (military.number) — не РНОКПП
		MILITARY_NUMBER: getVal(military.number),
		EMPLOYEE_RNOKPP: getVal(employee.rnokpp),
		EMPLOYEE_DOB: getVal(employee.dob),
		EMPLOYEE_ADDRESS: getVal(employee.address),
		// FIX-9: дата документу (поле "Сформовано")
		FORMATION_DATE: formatDateUA(getVal(military.doc_date)),
		MIL_DOC_NUMBER: getVal(military.number),
		MIL_DOC_DATE: formatDateUA(getVal(military.issued_date)),
		VOS_NUMBER: getVal(military.vos),
		// FIX-10: поле 7 — дата події та тип
		EVENT_DATE: eventDate,
		CHANGE_TYPE_PAST_UA: changeType === 'звільнення'
			? `${formatDateUA(eventDate)} ${changeTypePast} з ${toOrgSentenceCase(orgName)}`
			: changeTypePast,
		CHANGE_DATA: changeType === 'звільнення'
			? `${formatDateUA(eventDate)} ${changeTypePast} з ${getOrgNameGenitive(orgName)}`
			: `${formatDateUA(eventDate)} ${changeTypePast} на роботу в ${orgNameShort}`,
		ORDER_BASIS: `Наказ № ${getVal(order.number)} від ${orderDate}`,
		// FIX-11: назва організації
		EMPLOYER_NAME_FULL: orgName.toUpperCase(),
		EMPLOYER_NAME_SHORT: orgNameShort,
		MIL_RANK: getVal(military.rank),
		// FIX-13: директор з ініціалами для Додатку 4
		DIRECTOR_NAME: formatToInitials(getVal(employer.director_name)),
	};
	return fillTemplate(ANNEX4_TEMPLATE_ID, fileName, replacements);
}
