import {
  Table,
  TableRow,
  TableCell,
  Paragraph,
  AlignmentType,
  VerticalAlign,
  WidthType,
  TableLayoutType,
} from "docx";

// ===== CONSTANTS =====
const BASE_COLUMNS = 4;
const DAYS = 16;
const SUMMARY = 6;

const TOTAL_COLUMNS = BASE_COLUMNS + DAYS + SUMMARY; // 26

// ===== COLUMN WIDTHS (DXA) =====
const columnWidths = [
  300,
  700,
  500,
  2500,

  ...Array(DAYS).fill(350),

  600,
  700,
  700,
  700,
  700,
  900,
];

if (columnWidths.length !== TOTAL_COLUMNS) {
  throw new Error(`Invalid column count: ${columnWidths.length} !== ${TOTAL_COLUMNS}`);
}


// ===== CELL HELPERS =====
const createHeaderCell = ({
  text = "",
  colSpan = 1,
  rowSpan = 1,
  align = AlignmentType.CENTER,
}) =>
  new TableCell({
    columnSpan: colSpan,
    rowSpan: rowSpan,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        text,
        alignment: align,
      }),
    ],
  });

const createBodyCell = ({
  text = "",
  align = AlignmentType.CENTER,
}) =>
  new TableCell({
    children: [
      new Paragraph({
        text,
        alignment: align,
      }),
    ],
  });

// ===== HEADER ROWS =====
const headerRow1 = new TableRow({
  children: [
    createHeaderCell({ text: "№\nп/п", rowSpan: 5 }),
    createHeaderCell({ text: "Табельний\nномер", rowSpan: 5 }),
    createHeaderCell({ text: "Стать\n(ч/ж)", rowSpan: 5 }),
    createHeaderCell({ text: "П. І. Б., посада", rowSpan: 5 }),

    createHeaderCell({
      text: "Відмітки про явки та неявки за числами місяця (годин)",
      colSpan: 16,
    }),

    createHeaderCell({
      text: "Відпрацьовано за місяць",
      colSpan: 6,
    }),
  ],
});

// Row 2: days 01–15 + Х (rowSpan:2), днів (rowSpan:4), Годин (colSpan:5)
const headerRow2 = new TableRow({
  children: [
    ...Array.from({ length: 15 }, (_, i) =>
      createHeaderCell({ text: String(i + 1).padStart(2, "0"), rowSpan: 2 })
    ),
    createHeaderCell({ text: "Х", rowSpan: 2 }),
    createHeaderCell({ text: "днів", rowSpan: 4 }),
    createHeaderCell({ text: "Годин", colSpan: 5 }),
  ],
});

// Row 3: всього (rowSpan:3), з них: (colSpan:4)
// days 01–16 and Х still occupied by rowSpan:2 from row2
const headerRow3 = new TableRow({
  children: [
    createHeaderCell({ text: "всього", rowSpan: 3 }),
    createHeaderCell({ text: "з них:", colSpan: 4 }),
  ],
});

// Row 4: days 16–31 (rowSpan:2), detail cells (rowSpan:2)
// days 01–16 and Х now free; днів and всього still occupied
const headerRow4 = new TableRow({
  children: [
    ...Array.from({ length: 16 }, (_, i) =>
      createHeaderCell({ text: String(i + 16).padStart(2, "0"), rowSpan: 2 })
    ),
    createHeaderCell({ text: "наду-\nрочно", rowSpan: 2 }),
    createHeaderCell({ text: "ніч-\nних", rowSpan: 2 }),
    createHeaderCell({ text: "вечір-\nніх", rowSpan: 2 }),
    createHeaderCell({ text: "вихід-\nних, свят-\nкових", rowSpan: 2 }),
  ],
});

// Row 5: all columns occupied by rowSpan — empty row required to complete structure
const headerRow5 = new TableRow({
  children: [],
});

// ===== HELPERS =====
function normalizeDays(days) {
  if (!Array.isArray(days)) return [];

  if (days.length === 16) return days;

  if (days.length === 31) {
    return Array.from({ length: 16 }, (_, i) => ({
      top: i < 15 ? days[i] : "Х",
      bottom: days[i + 15] || "",
    }));
  }

  return [];
}

// ===== EMPLOYEE ROWS (4 rows per employee) =====
function createEmployeeRows({ index, tabNumber, gender, name, days = [], summary = {} }) {
  const normalized = normalizeDays(days);

  const spanCell = (text, opts = {}) =>
    new TableCell({
      rowSpan: opts.rowSpan || 1,
      verticalAlign: VerticalAlign.CENTER,
      children: [
        new Paragraph({
          text: String(text || ""),
          alignment: opts.align || AlignmentType.CENTER,
        }),
      ],
    });

  const emptyDayCells = () =>
    Array.from({ length: 16 }, () => createBodyCell({ text: "" }));

  // Row 1: base (rowSpan:4) + top day values + summary (rowSpan:4)
  const row1 = new TableRow({
    children: [
      spanCell(index,      { rowSpan: 4 }),
      spanCell(tabNumber,  { rowSpan: 4 }),
      spanCell(gender,     { rowSpan: 4 }),
      spanCell(name,       { rowSpan: 4, align: AlignmentType.LEFT }),

      ...normalized.map((d) => createBodyCell({ text: d?.top || "" })),

      spanCell(summary.days     || "", { rowSpan: 4 }),
      spanCell(summary.hours    || "", { rowSpan: 4 }),
      spanCell(summary.total    || "", { rowSpan: 4 }),
      spanCell(summary.overtime || "", { rowSpan: 4 }),
      spanCell(summary.night    || "", { rowSpan: 4 }),
      spanCell(summary.weekend  || "", { rowSpan: 4 }),
    ],
  });

  // Rows 2–3: only 16 empty day cells
  const row2 = new TableRow({ children: emptyDayCells() });
  const row3 = new TableRow({ children: emptyDayCells() });

  // Row 4: bottom day values (16–31)
  const row4 = new TableRow({
    children: normalized.map((d) => createBodyCell({ text: d?.bottom || "" })),
  });

  return [row1, row2, row3, row4];
}

// ===== TOTAL ROW =====
const createTotalRow = ({
  summary = {},
}) => {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: 20,
        children: [
          new Paragraph({
            text: "РАЗОМ:",
            alignment: AlignmentType.RIGHT,
          }),
        ],
      }),

      createBodyCell({ text: summary.days || "" }),
      createBodyCell({ text: summary.hours || "" }),
      createBodyCell({ text: summary.total || "" }),
      createBodyCell({ text: summary.overtime || "" }),
      createBodyCell({ text: summary.night || "" }),
      createBodyCell({ text: summary.weekend || "" }),
    ],
  });
};

// ===== GENERATOR =====
export default (spec) => {
  const { employees, total } = spec;

  const employeeRows = employees.flatMap(createEmployeeRows);
  const totalRow = createTotalRow({ summary: total });

  return new Table({
    layout: TableLayoutType.FIXED,

    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },

    columnWidths,

    rows: [
      headerRow1,
      headerRow2,
      headerRow3,
      headerRow4,
      headerRow5,
      ...employeeRows,
      totalRow,
    ],
  });
};
