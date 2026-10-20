// One-time script: creates the Особова картка П-2 Google Doc template.
// Run createOsobovaTemplate() once from the Apps Script editor.
// Copy the logged Doc ID and set it as wrangler secret OSOBOVA_TEMPLATE_ID.

const TEMPLATE_FOLDER_ID = '1G5DbiCGHoFCCCnuny0qrWliyYVN1F_lR';

function createOsobovaTemplate() {
	const doc = DocumentApp.create('ОСОБОВА_КАРТКА_П2_TEMPLATE');
	const body = doc.getBody();
	body.clear();

	const style = {};
	style[DocumentApp.Attribute.FONT_FAMILY] = 'Times New Roman';
	style[DocumentApp.Attribute.FONT_SIZE] = 11;
	body.setAttributes(style);

	// ── Заголовок ─────────────────────────────────────────────────
	const h = body.appendParagraph('ОСОБОВА КАРТКА № ___');
	h.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
	h.editAsText().setBold(true);

	body.appendParagraph('(Типова форма П-2)')
		.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

	body.appendParagraph('');

	// ── Організація ───────────────────────────────────────────────
	_section(body, 'Організація');
	_row(body, 'Назва організації', '{{ORG_NAME}}');
	_row(body, 'ЄДРПОУ', '{{ORG_EDRPOU}}');

	// ── Зайнятість ────────────────────────────────────────────────
	_section(body, 'Зайнятість');
	_row(body, 'Підрозділ', '{{DEPARTMENT}}');
	_row(body, 'Посада', '{{POSITION}}');
	_row(body, 'Вид зайнятості', '{{EMPLOYMENT_TYPE}}');
	_row(body, 'Оклад (тарифна ставка)', '{{SALARY}}');
	_row(body, 'Дата прийняття на роботу', '{{HIRE_DATE}}');
	_row(body, 'Наказ про прийняття: №', '{{HIRE_ORDER_NUMBER}}');
	_row(body, 'Дата наказу про прийняття', '{{HIRE_ORDER_DATE}}');

	// ── Особисті дані ─────────────────────────────────────────────
	_section(body, 'Особисті дані');
	_row(body, 'Прізвище', '{{LAST_NAME}}');
	_row(body, "Ім'я", '{{FIRST_NAME}}');
	_row(body, 'По батькові', '{{PATRONYMIC}}');
	_row(body, 'ПІБ повністю', '{{FULL_NAME}}');
	_row(body, 'Дата народження', '{{BIRTH_DATE}}');
	_row(body, 'Місце народження', '{{BIRTH_PLACE}}');
	_row(body, 'Стать', '{{GENDER}}');
	_row(body, 'Громадянство', '{{CITIZENSHIP}}');
	_row(body, 'РНОКПП (ІПН)', '{{TAX_ID}}');
	_row(body, 'Сімейний стан', '{{MARITAL_STATUS}}');
	_row(body, 'Кількість дітей', '{{CHILDREN_COUNT}}');

	// ── Документ ──────────────────────────────────────────────────
	_section(body, 'Документ, що посвідчує особу');
	_row(body, 'Тип документа', '{{PASSPORT_TYPE}}');
	_row(body, 'Серія', '{{PASSPORT_SERIES}}');
	_row(body, 'Номер', '{{PASSPORT_NUMBER}}');
	_row(body, 'Ким виданий', '{{PASSPORT_ISSUED_BY}}');
	_row(body, 'Дата видачі', '{{PASSPORT_ISSUE_DATE}}');
	_row(body, 'Дійсний до', '{{PASSPORT_EXPIRY_DATE}}');
	_row(body, 'УНЗР (для ID-карти)', '{{PASSPORT_RECORD_NUMBER}}');

	// ── Адреса та контакти ────────────────────────────────────────
	_section(body, 'Адреса та контакти');
	_row(body, 'Адреса реєстрації', '{{ADDRESS_REGISTRATION}}');
	_row(body, 'Фактична адреса', '{{ADDRESS_ACTUAL}}');
	_row(body, 'Телефон', '{{PHONE}}');
	_row(body, 'Email', '{{EMAIL}}');

	// ── Освіта ────────────────────────────────────────────────────
	_section(body, 'Освіта');
	_row(body, 'Рівень освіти', '{{EDUCATION_LEVEL}}');
	_row(body, 'Навчальний заклад', '{{EDUCATION_INSTITUTION}}');
	_row(body, 'Факультет', '{{EDUCATION_FACULTY}}');
	_row(body, 'Спеціальність', '{{EDUCATION_SPECIALTY}}');
	_row(body, 'Кваліфікація', '{{EDUCATION_QUALIFICATION}}');
	_row(body, 'Серія диплома', '{{DIPLOMA_SERIES}}');
	_row(body, 'Номер диплома', '{{DIPLOMA_NUMBER}}');
	_row(body, 'Дата видачі диплома', '{{DIPLOMA_DATE}}');
	_row(body, 'Рік закінчення', '{{GRADUATION_YEAR}}');

	// ── Військовий облік ──────────────────────────────────────────
	_section(body, 'Військовий облік');
	_row(body, 'Військове звання', '{{MILITARY_RANK}}');
	_row(body, 'Категорія запасу', '{{MILITARY_CATEGORY}}');
	_row(body, 'ВОС (код)', '{{MILITARY_SPECIALTY_CODE}}');
	_row(body, 'ТЦК / РВК', '{{MILITARY_UNIT}}');

	// ── Службове ──────────────────────────────────────────────────
	_section(body, 'Службове');
	_row(body, 'Дата заповнення', '{{FILL_DATE}}');

	doc.saveAndClose();

	// Move to the templates folder
	const file = DriveApp.getFileById(doc.getId());
	DriveApp.getFolderById(TEMPLATE_FOLDER_ID).addFile(file);
	DriveApp.getRootFolder().removeFile(file);

	Logger.log('Template created. ID: ' + doc.getId());
	Logger.log('Link: https://docs.google.com/document/d/' + doc.getId() + '/edit');
	Logger.log('');
	Logger.log('Run this to set the secret:');
	Logger.log('  wrangler secret put OSOBOVA_TEMPLATE_ID');
	Logger.log('  > ' + doc.getId());
}

function _section(body, title) {
	const p = body.appendParagraph(title);
	p.editAsText().setBold(true);
	p.setSpacingBefore(8);
}

function _row(body, label, placeholder) {
	body.appendParagraph(label + ':  ' + placeholder);
}
