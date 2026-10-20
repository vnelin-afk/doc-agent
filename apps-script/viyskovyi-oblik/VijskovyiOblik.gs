// Список персонального військового обліку (Додаток 5) — Google Doc + {{placeholder}} + pattern-row clone.
// Структурно скопійовано з apps-script/vacation/Vacation.gs (D001: Docs, не Sheets — таблиця проста, без merged cells).
// На відміну від Vacation.gs: PATTERN_ROWS = 1 (один рядок = один працівник, без rowspan/merge — тут не потрібно).

const VO_TEMPLATE_ID = '1rC9Wejga_iViPKGCMj1pncAMnxAOvFs1KhGHv-oKILc';
const RESULTS_FOLDER_ID = '1G5DbiCGHoFCCCnuny0qrWliyYVN1F_lR';

// Плейсхолдери в шаблоні — {{key}} lowercase, ключ = поле VO_FIELDS (src/features/viyskovyi-oblik/schema.js).
const VO_FIELD_KEYS = [
  'military_rank', 'full_name', 'birth_date', 'reg_number', 'vos_code', 'composition',
  'registration_category', 'education', 'passport', 'registered_address', 'actual_address',
  'tsk_name', 'spec_registration', 'fitness', 'family_status', 'position_order', 'notification_manual',
];

// Аліаси: назва плейсхолдера в шаблоні → ключ даних з VO_FIELD_KEYS.
// Шаблон Google Doc може використовувати скорочені назви, відмінні від schema.js.
const TEMPLATE_ALIASES = {
  'reg_inn': 'reg_number',
  'reg_category': 'registration_category',
  'special_reg': 'spec_registration',
  'notification_ref': 'notification_manual',
};

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const employees = data.employees || [];
    const orgName = data.org_name || '';

    const templateFile = DriveApp.getFileById(VO_TEMPLATE_ID);
    const today = Utilities.formatDate(new Date(), 'Europe/Kyiv', 'dd.MM.yyyy');
    const docName = `Список_військового_обліку_${orgName ? orgName + '_' : ''}${today}`;
    const resultsFolder = DriveApp.getFolderById(RESULTS_FOLDER_ID);
    const newFile = templateFile.makeCopy(docName, resultsFolder);
    const doc = DocumentApp.openById(newFile.getId());
    const body = doc.getBody();

    // I001: {{org_name}} — шапка документа (поза таблицею), body.replaceText як у Vacation.gs.
    body.replaceText('\\{\\{org_name\\}\\}', orgName);
    fillVoTable(body, employees);
    doc.saveAndClose();

    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        docUrl: `https://docs.google.com/document/d/${newFile.getId()}/edit`,
        driveUrl: `https://drive.google.com/file/d/${newFile.getId()}/view`
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function fillVoTable(body, employees) {
  const tables = body.getTables();
  let voTable = null;

  const indexRegex = buildLenientPlaceholderRegex('{{index}}');

  for (let t = 0; t < tables.length; t++) {
    if (indexRegex.test(tables[t].getText())) {
      voTable = tables[t];
      break;
    }
  }
  if (!voTable) return;

  let patternRow = -1;
  for (let i = 0; i < voTable.getNumRows(); i++) {
    if (indexRegex.test(voTable.getRow(i).getText())) {
      patternRow = i;
      break;
    }
  }
  if (patternRow === -1) return;

  const PATTERN_ROWS = 1;

  if (employees.length === 0) {
    voTable.removeRow(patternRow);
    return;
  }

  // Копіюємо патерн-рядок по одному разу на кожного додаткового працівника
  for (let empIdx = 1; empIdx < employees.length; empIdx++) {
    const sourceRow = voTable.getRow(patternRow);
    const insertIndex = patternRow + empIdx;
    const newRow = voTable.insertTableRow(insertIndex);
    for (let c = 0; c < sourceRow.getNumCells(); c++) {
      const sourceCell = sourceRow.getCell(c);
      const newCell = c < newRow.getNumCells() ? newRow.getCell(c) : newRow.appendTableCell();
      newCell.setText(sourceCell.getText());
    }
  }

  // Заповнюємо кожен рядок
  for (let empIdx = 0; empIdx < employees.length; empIdx++) {
    const emp = employees[empIdx];
    const row = voTable.getRow(patternRow + empIdx);

    replaceInRow(row, '{{index}}', String(empIdx + 1));
    for (const key of VO_FIELD_KEYS) {
      replaceInRow(row, `{{${key}}}`, emp[key] || '');
    }
    for (const [alias, dataKey] of Object.entries(TEMPLATE_ALIASES)) {
      replaceInRow(row, `{{${alias}}}`, emp[dataKey] || '');
    }
  }

  // Прибрати залишкові {{...}} з клітинок (невідповідність назв плейсхолдерів шаблону і коду).
  // НЕ видаляємо рядки (I002) — лише чистимо текст плейсхолдерів у кожній клітинці.
  var placeholderPattern = /\{\{[^}]*\}\}/g;
  for (var i = 0; i < employees.length; i++) {
    var row = voTable.getRow(patternRow + i);
    for (var c = 0; c < row.getNumCells(); c++) {
      var cell = row.getCell(c);
      var text = cell.getText();
      if (placeholderPattern.test(text)) {
        cell.setText(text.replace(placeholderPattern, ''));
      }
      placeholderPattern.lastIndex = 0;
    }
  }
}

// I002: конвертація .docx → Google Doc іноді розбиває {{placeholder}} параграфом усередині токена
// (getText() тоді повертає, напр., "{{ind\nex}}" замість "{{index}}"), тож точний рядок не збігається.
// \s* між кожним символом толерує будь-який пробільний розрив у довільному місці — звичайний суцільний
// текст так само збігається (\s* допускає нуль пробілів), поведінка для непошкодженого шаблону незмінна.
function buildLenientPlaceholderRegex(placeholder) {
  const pattern = placeholder
    .split('')
    .map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s*');
  return new RegExp(pattern);
}

// Портовано з Vacation.gs, доповнено толерантним regex-матчингом (I002) замість точного рядка.
function replaceInRow(row, placeholder, value) {
  const regex = buildLenientPlaceholderRegex(placeholder);
  for (let c = 0; c < row.getNumCells(); c++) {
    const cell = row.getCell(c);
    const text = cell.getText();
    if (regex.test(text)) {
      cell.setText(text.replace(regex, value));
      cell.editAsText().setBold(false);
    }
  }
}
