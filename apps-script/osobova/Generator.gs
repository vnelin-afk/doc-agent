const OSOBOVA_TEMPLATE_ID = PropertiesService.getScriptProperties().getProperty('OSOBOVA_TEMPLATE_ID');
const RESULTS_FOLDER_ID = '1G5DbiCGHoFCCCnuny0qrWliyYVN1F_lR';

const FIELDS = [
	['ORG_NAME', 'org_name'],
	['ORG_EDRPOU', 'org_edrpou'],
	['DATE_FILLED', 'fill_date'],
	['TABEL_NUMBER', 'tabel_number'],
	['IPN', 'tax_id'],
	['GENDER', 'gender'],
	['WORK_TYPE', 'employment_type'],
	['LAST_NAME', 'last_name'],
	['FIRST_NAME', 'first_name'],
	['PATRONYMIC', 'patronymic'],
	['BIRTH_DATE', 'birth_date'],
	['CITIZENSHIP', 'citizenship'],
	['EDU_INSTITUTION', 'education_institution'],
	['EDU_DIPLOMA', 'edu_diploma'],
	['EDU_YEAR', 'graduation_year'],
	['EDU_SPECIALTY', 'education_specialty'],
	['EDU_QUALIFICATION', 'education_qualification'],
	['EDU_FORM', 'edu_form'],
	['PREV_WORK_PLACE', 'prev_work_place'],
	['PREV_WORK_POSITION', 'prev_work_position'],
	['WORK_EXPERIENCE_DATE', 'work_experience_date'],
	['WORK_EXP_YEARS', 'work_exp_years'],
	['WORK_EXP_MONTHS', 'work_exp_months'],
	['PENSION_INFO', 'pension_info'],
	['ADDRESS_ACTUAL', 'address_actual'],
	['ADDRESS_REGISTERED', 'address_registration'],
	['PASSPORT_SERIES', 'passport_series'],
	['PASSPORT_NUMBER', 'passport_number'],
	['PASSPORT_ISSUED_BY', 'passport_issued_by'],
	['PASSPORT_ISSUED_DATE', 'passport_issue_date'],
	['MIL_FITNESS', 'mil_fitness'],
	['MIL_CATEGORY', 'military_category'],
	['MIL_TCK_REGISTERED', 'mil_tck_registered'],
	['MIL_RANK', 'military_rank'],
	['MIL_TCK', 'military_unit'],
	['MIL_VOS', 'military_specialty_code'],
	['MIL_OBERIG', 'mil_oberig'],
	['APPOINTMENT_DATE', 'hire_date'],
	['DEPARTMENT', 'department'],
	['POSITION', 'position'],
	['POSITION_KP_CODE', 'position_kp_code'],
	['SALARY', 'salary'],
	['ORDER_NUMBER_DATE', 'order_number_date'],
	['ORDER_SIGNATORY_POSITION', 'order_signatory_position'],
	['ORDER_SIGNATORY_NAME', 'order_signatory_name'],
];

function extractQuotedName(str) {
	if (!str) return '';
	const m = String(str).match(/[«"]([^»"]+)[»"]/);
	return m ? m[1].trim() : String(str).trim();
}

function doPost(e) {
	try {
		const data = JSON.parse(e.postData.contents);
		const spec = data.spec || data;

		spec.edu_diploma = [spec.diploma_series, spec.diploma_number].filter(Boolean).join(' ');

		const today = Utilities.formatDate(new Date(), 'Europe/Kyiv', 'dd.MM.yyyy');
		const candidateName = [spec.last_name, spec.first_name].filter(Boolean).join(' ').trim();
		const orgShort = extractQuotedName(spec.org_name);
		const fileName = ['Особова картка', candidateName || 'Невідомо', orgShort, today].filter(Boolean).join(' — ');
		const folder = DriveApp.getFolderById(RESULTS_FOLDER_ID);
		Logger.log('templateId: ' + OSOBOVA_TEMPLATE_ID);
		const copy = DriveApp.getFileById(OSOBOVA_TEMPLATE_ID).makeCopy(fileName, folder);
		const token = ScriptApp.getOAuthToken();
		const requests = FIELDS.map(([placeholder, key]) => ({
			findReplace: {
				find: '{{' + placeholder + '}}',
				replacement: String(spec[key] || ''),
				allSheets: true
			}
		}));
		UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/' + copy.getId() + ':batchUpdate', {
			method: 'POST',
			headers: { 'Authorization': 'Bearer ' + token },
			contentType: 'application/json',
			payload: JSON.stringify({ requests }),
			muteHttpExceptions: true
		});

		return ContentService
			.createTextOutput(JSON.stringify({ ok: true, document_link: copy.getUrl(), document_id: copy.getId() }))
			.setMimeType(ContentService.MimeType.JSON);
	} catch (err) {
		return ContentService
			.createTextOutput(JSON.stringify({ ok: false, error: err.message + ' [templateId: ' + OSOBOVA_TEMPLATE_ID + ']' }))
			.setMimeType(ContentService.MimeType.JSON);
	}
}
