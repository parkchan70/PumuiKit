import { amountOf, newId, type Item } from "./types";
import { toNumber } from "./format";

export const CSV_HEADERS = ["내용", "규격", "단위", "수량", "예상단가", "예상금액"] as const;

function escapeCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** 품목 행만 내보냅니다. 합계 행은 넣지 않습니다(품의서식과 동일). */
export function itemsToCsv(items: Item[]): string {
  const rows: string[] = [CSV_HEADERS.join(",")];
  for (const it of items) {
    rows.push(
      [
        escapeCell(it.name),
        escapeCell(it.spec),
        escapeCell(it.unit),
        String(it.qty),
        String(it.unitPrice),
        String(amountOf(it)),
      ].join(","),
    );
  }
  // 엑셀이 UTF-8 로 열도록 BOM 을 붙입니다.
  return "﻿" + rows.join("\r\n") + "\r\n";
}

/** 아주 단순한 RFC4180 파서 — 우리가 내보낸 CSV를 되읽는 용도입니다. */
export function csvToItems(csv: string): Item[] {
  const text = csv.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const clean = rows.filter((r) => r.some((c) => c.trim().length > 0));
  if (clean.length === 0) return [];

  const header = clean[0].map((c) => c.trim());
  const isHeader = header.some((c) => ["내용", "상품명", "품명", "품목"].includes(c));
  const body = isHeader ? clean.slice(1) : clean;

  const idx = (names: string[], fallback: number) => {
    const found = header.findIndex((c) => names.includes(c));
    return isHeader && found >= 0 ? found : fallback;
  };
  const cName = idx(["내용", "상품명", "품명", "품목"], 0);
  const cSpec = idx(["규격", "사양", "옵션"], 1);
  const cUnit = idx(["단위"], 2);
  const cQty = idx(["수량"], 3);
  const cPrice = idx(["예상단가", "단가"], 4);
  const cAmount = idx(["예상금액", "금액"], 5);

  const items: Item[] = [];
  for (const r of body) {
    const name = (r[cName] ?? "").trim();
    if (!name || /^(합계|총계|소계)$/.test(name)) continue;
    const qty = Math.max(1, toNumber(r[cQty]) || 1);
    let unitPrice = toNumber(r[cPrice]);
    const amount = toNumber(r[cAmount]);
    if (!unitPrice && amount) unitPrice = Math.round(amount / qty);
    items.push({
      id: newId(),
      name,
      spec: (r[cSpec] ?? "").trim(),
      unit: (r[cUnit] ?? "").trim(),
      qty,
      unitPrice,
    });
  }
  return items;
}
