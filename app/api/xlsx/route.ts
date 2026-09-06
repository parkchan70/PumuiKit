import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { contentDisposition, todayStamp } from "@/lib/format";

export const runtime = "nodejs";

/**
 * 사용자가 준 "품의서식참고.xls" 를 그대로 재현합니다.
 *   A 내용(32) / B 규격(12.5) / C 수량(6.3) / D 예상단가(10.4) / E 예상금액(10.5)
 *   머리글 굴림 9pt · 회색(C0C0C0) 채움, 본문 굴림 10pt, 전 셀 가운데 정렬 · 실선 테두리
 *   행 높이 17.4pt, 예상금액은 =수량*단가 수식, A4 세로 (여백 0.7" / 0.75")
 */

type Row = { name?: string; spec?: string; unit?: string; qty?: number; unitPrice?: number };

type Body = {
  items?: Row[];
  /** 참고 서식에 없는 "단위" 열을 함께 내보낼지 */
  includeUnit?: boolean;
  /** 마지막에 합계 행을 붙일지 */
  includeTotal?: boolean;
  /** 파일 이름에만 쓰입니다 */
  title?: string;
};

const FONT_BODY = { name: "굴림", size: 10 } as const;
const FONT_HEAD = { name: "굴림", size: 9 } as const;
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};
const CENTER: Partial<ExcelJS.Alignment> = { horizontal: "center", vertical: "middle" };
const ROW_HEIGHT = 17.4;

/**
 * 엑셀은 열 너비 속성값에서 좌우 여백(약 0.7자)을 뺀 값을 화면에 보여줍니다.
 * 참고 서식과 눈에 보이는 너비를 맞추려면 그만큼 더해서 써야 합니다.
 */
const WIDTH_PADDING = 0.69921875;

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });
  }

  const items = (body.items ?? []).filter((it) => (it.name ?? "").trim().length > 0);
  if (items.length === 0) {
    return NextResponse.json({ error: "내보낼 품목이 없습니다." }, { status: 400 });
  }

  const includeUnit = Boolean(body.includeUnit);
  const includeTotal = body.includeTotal !== false;

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
  const widths = includeUnit
    ? [32, 12.5, 6.3, 6.3, 10.4, 10.5]
    : [32, 12.5, 6.3, 10.4, 10.5];

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
  const lastCol = includeUnit ? "F" : "E";
  const colCount = headers.length;

  const firstDataRow = 2;
  for (const item of items) {
    const values = includeUnit
      ? [item.name ?? "", item.spec ?? "", item.unit ?? "", num(item.qty, 1), num(item.unitPrice, 0)]
      : [item.name ?? "", item.spec ?? "", num(item.qty, 1), num(item.unitPrice, 0)];

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

  const lastDataRow = sheet.rowCount;

  if (includeTotal) {
    const totalRow = sheet.addRow([]);
    totalRow.height = ROW_HEIGHT;
    totalRow.getCell(1).value = "합계";
    sheet.mergeCells(totalRow.number, 1, totalRow.number, colCount - 1);
    totalRow.getCell(colCount).value = {
      formula: `SUM(${lastCol}${firstDataRow}:${lastCol}${lastDataRow})`,
      date1904: false,
    };
    for (let c = 1; c <= colCount; c++) {
      const cell = totalRow.getCell(c);
      cell.font = { ...FONT_BODY, bold: true };
      cell.alignment = { ...CENTER };
      cell.border = { ...THIN };
    }
  }

  // 머리글은 인쇄할 때마다 반복
  sheet.pageSetup.printTitlesRow = "1:1";

  const buffer = await workbook.xlsx.writeBuffer();
  const base = sanitize(body.title) || "품의_품목내역";
  const filename = `${base}_${todayStamp()}.xlsx`;

  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDisposition(filename),
      "Cache-Control": "no-store",
    },
  });
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function sanitize(title?: string): string {
  if (!title) return "";
  return title
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
