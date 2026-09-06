import type ExcelJSType from "exceljs";
import type { Item } from "./types";

/**
 * 사용자가 준 "품의서식참고.xls" 를 그대로 재현합니다. 전부 브라우저에서 만듭니다.
 *   A 내용(32) / B 규격(12.5) / C 수량(6.3) / D 예상단가(10.4) / E 예상금액(10.5)
 *   머리글 굴림 9pt · 회색(C0C0C0) 채움, 본문 굴림 10pt, 전 셀 가운데 정렬 · 실선 테두리
 *   행 높이 17.4pt, 예상금액은 =수량*단가 수식, A4 세로 (여백 0.7" / 0.75")
 */

const FONT_BODY = { name: "굴림", size: 10 } as const;
const FONT_HEAD = { name: "굴림", size: 9 } as const;
const THIN: Partial<ExcelJSType.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};
const CENTER: Partial<ExcelJSType.Alignment> = { horizontal: "center", vertical: "middle" };
const ROW_HEIGHT = 17.4;

/**
 * 엑셀은 열 너비 속성값에서 좌우 여백(약 0.7자)을 뺀 값을 화면에 보여줍니다.
 * 참고 서식과 눈에 보이는 너비를 맞추려면 그만큼 더해서 써야 합니다.
 */
const WIDTH_PADDING = 0.69921875;

export type XlsxOptions = {
  /** 참고 서식에 없는 "단위" 열을 함께 내보낼지 */
  includeUnit?: boolean;
};

export async function buildXlsx(items: Item[], options: XlsxOptions = {}): Promise<Blob> {
  const rows = items.filter((it) => it.name.trim().length > 0);
  if (rows.length === 0) throw new Error("내보낼 품목이 없습니다.");

  const includeUnit = Boolean(options.includeUnit);

  const ExcelJS = (await import("exceljs")).default;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PumuiKit";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("품의", {
    properties: { defaultRowHeight: ROW_HEIGHT, dyDescent: 0.4 },
    // <sheetViews> 가 없으면 엑셀이 행 높이(ht)를 통째로 무시합니다. 반드시 남겨 두세요.
    views: [{ state: "normal", showGridLines: true }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: "portrait",
      margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    },
  });

  const headers = includeUnit
    ? ["내용", "규격", "단위", "수량", "예상단가", "예상금액"]
    : ["내용", "규격", "수량", "예상단가", "예상금액"];
  const widths = includeUnit ? [32, 12.5, 6.3, 6.3, 10.4, 10.5] : [32, 12.5, 6.3, 10.4, 10.5];

  sheet.columns = widths.map((width) => ({ width: width + WIDTH_PADDING }));

  const headerRow = sheet.addRow(headers);
  headerRow.height = ROW_HEIGHT;
  headerRow.eachCell((cell) => {
    cell.font = { ...FONT_HEAD };
    cell.alignment = { ...CENTER };
    cell.border = { ...THIN };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC0C0C0" } };
  });

  const qtyCol = includeUnit ? "D" : "C";
  const priceCol = includeUnit ? "E" : "D";
  const colCount = headers.length;

  for (const item of rows) {
    const values = includeUnit
      ? [item.name, item.spec, item.unit, item.qty, item.unitPrice]
      : [item.name, item.spec, item.qty, item.unitPrice];

    const row = sheet.addRow(values);
    row.height = ROW_HEIGHT;
    row.getCell(colCount).value = {
      formula: `${qtyCol}${row.number}*${priceCol}${row.number}`,
      date1904: false,
    };
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      cell.font = { ...FONT_BODY };
      cell.alignment = { ...CENTER };
      cell.border = { ...THIN };
    }
  }

  // 합계 행은 넣지 않습니다. 참고 서식에도 없고, 품의서 본문에서 따로 잡는 값입니다.
  // (화면 표에는 그대로 보입니다.)

  // 머리글은 인쇄할 때마다 반복
  sheet.pageSetup.printTitlesRow = "1:1";

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
