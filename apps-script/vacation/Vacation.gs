const VACATION_TEMPLATE_ID = '1tFnmq4ocxB20YHIRtLcIAAPupEJBZf_GaApI_exhUdc';  // заповнити вручну після clasp create
const RESULTS_FOLDER_ID = '1G5DbiCGHoFCCCnuny0qrWliyYVN1F_lR';

function extractOrgShortName(orgName) {
  if (!orgName) return '';
  const m = orgName.match(/«([^»]+)»/);
  return m ? m[1] : orgName;
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const employees = data.employees || [];
    const orgShortName = extractOrgShortName(data.org_name);

    const templateFile = DriveApp.getFileById(VACATION_TEMPLATE_ID);
    const docName = `Графік_відпусток_${orgShortName || data.org_name}_${data.year}`;
    const resultsFolder = DriveApp.getFolderById(RESULTS_FOLDER_ID);
    const newFile = templateFile.makeCopy(docName, resultsFolder);
    const doc = DocumentApp.openById(newFile.getId());
    const body = doc.getBody();

    body.replaceText('\\{\\{org_name\\}\\}', orgShortName);
    body.replaceText('\\{\\{org_short_name\\}\\}', orgShortName);
    body.replaceText('\\{\\{director_name\\}\\}', data.director_name || '');
    body.replaceText('\\{\\{sign_date\\}\\}', data.sign_date || '____');
    body.replaceText('\\{\\{city\\}\\}', data.city || '');
    body.replaceText('\\{\\{year\\}\\}', String(data.year || ''));

    const { patternStartRow, tableIndex } = fillVacationTable(body, employees, data.year || new Date().getFullYear());
    doc.saveAndClose();

    if (tableIndex >= 0) {
      mergeAndBorders(newFile.getId(), employees, patternStartRow, tableIndex);
    }

    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        link: `https://docs.google.com/document/d/${newFile.getId()}/edit`
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function computeVacPeriod(year, monthName, days) {
  const UA_MONTHS = ['Січень','Лютий','Березень','Квітень','Травень','Червень',
    'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
  const mi = UA_MONTHS.indexOf(monthName);
  if (mi === -1 || !days) return '';
  const d = Number(days);
  const pad = n => String(n).padStart(2, '0');
  // Vacation starts on day 1 of the month and runs for 'days' calendar days
  const endDay = new Date(year, mi, d);
  return `${pad(1)}.${pad(mi + 1)}.${year} - ${pad(endDay.getDate())}.${pad(endDay.getMonth() + 1)}.${endDay.getFullYear()}`;
}

function monthFromPeriodEnd(periodStr) {
  const UA_MONTHS = ['Січень','Лютий','Березень','Квітень','Травень','Червень',
    'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
  if (!periodStr) return '';
  const endPart = periodStr.split(' - ')[1] || periodStr.split(' - ')[0];
  if (!endPart) return '';
  const monthIdx = parseInt(endPart.split('.')[1], 10) - 1;
  return UA_MONTHS[monthIdx] || '';
}

function fillVacationTable(body, employees, year) {
  const tables = body.getTables();
  let vacationTable = null;
  let tableIndex = -1;

  for (let t = 0; t < tables.length; t++) {
    if (tables[t].getText().includes('{{number}}')) {
      vacationTable = tables[t];
      tableIndex = t;
      break;
    }
  }
  if (!vacationTable) return { patternStartRow: -1, tableIndex: -1 };

  let patternStartRow = -1;
  for (let i = 0; i < vacationTable.getNumRows(); i++) {
    if (vacationTable.getRow(i).getText().includes('{{number}}')) {
      patternStartRow = i;
      break;
    }
  }
  if (patternStartRow === -1) return { patternStartRow: -1, tableIndex: -1 };

  const PATTERN_ROWS = 2;

  if (employees.length === 0) {
    // Видаляємо рядки патерну щоб таблиця була порожньою
    for (let r = PATTERN_ROWS - 1; r >= 0; r--) {
      const rowIdx = patternStartRow + r;
      if (rowIdx < vacationTable.getNumRows()) {
        vacationTable.removeRow(rowIdx);
      }
    }
    return { patternStartRow, tableIndex };
  }

  // Копіюємо патерн для кожного додаткового працівника
  for (let empIdx = 1; empIdx < employees.length; empIdx++) {
    for (let r = 0; r < PATTERN_ROWS; r++) {
      const sourceRow = vacationTable.getRow(patternStartRow + r);
      const insertIndex = patternStartRow + empIdx * PATTERN_ROWS + r;
      const newRow = vacationTable.insertTableRow(insertIndex);
      for (let c = 0; c < sourceRow.getNumCells(); c++) {
        const sourceCell = sourceRow.getCell(c);
        const newCell = c < newRow.getNumCells() ? newRow.getCell(c) : newRow.appendTableCell();
        newCell.setText(sourceCell.getText());
      }
    }
  }

  // Заповнюємо дані кожного працівника
  const rowsToDelete = [];
  for (let empIdx = 0; empIdx < employees.length; empIdx++) {
    const emp = employees[empIdx];
    const rowData = emp.rows && emp.rows[0] ? emp.rows[0] : {};
    const baseRow = patternStartRow + empIdx * PATTERN_ROWS;

    // Використовуємо ПЕРІОД з Worker (або обчислюємо резервно)
    const period1 = rowData.period_1 || computeVacPeriod(year, rowData.vac_month_1, rowData.vac_days_1);
    const month1  = period1 ? monthFromPeriodEnd(period1) : (rowData.vac_month_1 || '');
    const period2 = rowData.period_2 || computeVacPeriod(year, rowData.vac_month_2, rowData.vac_days_2);
    const month2  = period2 ? monthFromPeriodEnd(period2) : (rowData.vac_month_2 || '');

    // Рядок 1
    const r1 = vacationTable.getRow(baseRow);
    replaceInRow(r1, '{{number}}', String(empIdx + 1));
    replaceInRow(r1, '{{full_name}}', emp.full_name || '');
    replaceInRow(r1, '{{position}}', emp.position || '');
    replaceInRow(r1, '{{period}}', period1);
    replaceInRow(r1, '{{vac_type_1}}', rowData.vac_type_1 || '');
    replaceInRow(r1, '{{vac_days_1}}', rowData.vac_days_1 != null ? String(rowData.vac_days_1) : '');
    replaceInRow(r1, '{{vac_month_1}}', month1);
    applyDataRowAlignment(r1);

    // Рядок 2
    if (emp.row_count === 2) {
      const r2 = vacationTable.getRow(baseRow + 1);
      replaceInRow(r2, '{{full_name}}', emp.full_name || '');
      replaceInRow(r2, '{{position}}', emp.position || '');
      replaceInRow(r2, '{{period}}', period2);
      replaceInRow(r2, '{{vac_type_2}}', rowData.vac_type_2 || '');
      replaceInRow(r2, '{{vac_days_2}}', rowData.vac_days_2 != null ? String(rowData.vac_days_2) : '');
      replaceInRow(r2, '{{vac_month_2}}', month2);
      applyDataRowAlignment(r2);
    } else {
      // Другий рядок не потрібен — видалимо після циклу
      rowsToDelete.push(baseRow + 1);
    }
  }

  // Видаляємо непотрібні рядки патерну та будь-які рядки з незаповненими плейсхолдерами
  for (let i = vacationTable.getNumRows() - 1; i >= patternStartRow; i--) {
    if (rowsToDelete.includes(i) || vacationTable.getRow(i).getText().includes('{{')) {
      vacationTable.removeRow(i);
    }
  }

  return { patternStartRow, tableIndex };
}

function mergeAndBorders(docId, employees, patternStartRow, tableIndex) {
  const token = ScriptApp.getOAuthToken();
  const PATTERN_ROWS = 2;

  const docRes = UrlFetchApp.fetch(
    `https://docs.googleapis.com/v1/documents/${docId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const docJson = JSON.parse(docRes.getContentText());

  const vacTableElem = findTableByIndex(docJson, tableIndex);
  if (!vacTableElem) return;
  const tableStartIndex = vacTableElem.startIndex;

  // Merge тільки колонки {{number}} (col 0) і тільки для row_count === 2
  const mergeRequests = [];
  for (let empIdx = 0; empIdx < employees.length; empIdx++) {
    if (employees[empIdx].row_count !== 2) continue;
    const startRow = patternStartRow + empIdx * PATTERN_ROWS;
    mergeRequests.push({
      mergeTableCells: {
        tableRange: {
          tableCellLocation: {
            tableStartLocation: { index: tableStartIndex },
            rowIndex: startRow,
            columnIndex: 0
          },
          rowSpan: 2,
          columnSpan: 1
        }
      }
    });
  }

  if (mergeRequests.length > 0) {
    UrlFetchApp.fetch(
      `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
      {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: `Bearer ${token}` },
        payload: JSON.stringify({ requests: mergeRequests }),
        muteHttpExceptions: true
      }
    );
  }

  // Перечитуємо після merge і виставляємо borders 1pt
  const docRes2 = UrlFetchApp.fetch(
    `https://docs.googleapis.com/v1/documents/${docId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const docJson2 = JSON.parse(docRes2.getContentText());
  const tableElem2 = findTableByIndex(docJson2, tableIndex);
  if (!tableElem2) return;

  const solidBorder = {
    color: { color: { rgbColor: { red: 0, green: 0, blue: 0 } } },
    width: { magnitude: 1, unit: 'PT' },
    dashStyle: 'SOLID'
  };

  const borderRequests = [];
  const rows = tableElem2.table.tableRows;
  for (let r = 0; r < rows.length; r++) {
    const rowCols = rows[r].tableCells.length;
    for (let c = 0; c < rowCols; c++) {
      borderRequests.push({
        updateTableCellStyle: {
          tableRange: {
            tableCellLocation: {
              tableStartLocation: { index: tableElem2.startIndex },
              rowIndex: r,
              columnIndex: c
            },
            rowSpan: 1,
            columnSpan: 1
          },
          tableCellStyle: {
            borderTop: solidBorder,
            borderBottom: solidBorder,
            borderLeft: solidBorder,
            borderRight: solidBorder
          },
          fields: 'borderTop,borderBottom,borderLeft,borderRight'
        }
      });
    }
  }

  if (borderRequests.length > 0) {
    UrlFetchApp.fetch(
      `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
      {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: `Bearer ${token}` },
        payload: JSON.stringify({ requests: borderRequests }),
        muteHttpExceptions: true
      }
    );
  }
}

function findTableByIndex(docJson, tableIndex) {
  let count = 0;
  for (const elem of docJson.body.content) {
    if (elem.table) {
      if (count === tableIndex) return elem;
      count++;
    }
  }
  return null;
}

function replaceInRow(row, placeholder, value) {
  for (let c = 0; c < row.getNumCells(); c++) {
    const cell = row.getCell(c);
    const text = cell.getText();
    if (text.includes(placeholder)) {
      cell.setText(text.replace(placeholder, value));
      // Strip bold inherited from template cell style
      cell.editAsText().setBold(false);
    }
  }
}

// Columns that should be center-aligned in employee data rows:
// 3=Вид відпустки, 4=Кількість днів, 5=Період, 6=Місяць
const CENTER_COLS = [3, 4, 5, 6];

function applyDataRowAlignment(row) {
  for (let c = 0; c < row.getNumCells(); c++) {
    if (CENTER_COLS.includes(c)) {
      const cell = row.getCell(c);
      cell.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
      cell.getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    }
  }
}
