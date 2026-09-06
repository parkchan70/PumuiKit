import type { ExtractedItem } from "./types";
import { toNumber } from "./format";

/**
 * 규칙 기반 장바구니 파서.
 *
 * API 키 없이도 "붙여넣기 → 표" 가 되도록 하는 오프라인 경로입니다.
 * 완벽할 수 없으므로 결과는 표에서 직접 고치는 것을 전제로 합니다.
 */

const NOISE =
  /^(무료\s*배송|배송비|배송\s*정보|평균\s*배송|합\s*배송|도착\s*예정|오늘출발|내일도착|장바구니|전체\s*선택|선택\s*삭제|삭제|찜하기|공유|더보기|바로\s*구매|구매하기|장바구니\s*담기|옵션\s*변경|쿠폰|적립|포인트|마일리지|리뷰|후기|판매자|브랜드|상품\s*번호|주문\s*금액|총\s*결제|결제\s*예정|할인\s*금액|즉시\s*할인|총\s*상품\s*금액|소계|총\s*합계|합계|총계|배송\s*예정|재입고|품절|수량\s*변경|주문서|안내|카드|무이자)/;

/** "12,000원" · "₩12,000" · "12000 원" */
const PRICE_G = /(?:₩\s*(\d{1,3}(?:,\d{3})*|\d+)|(\d{1,3}(?:,\d{3})+|\d+)\s*원)/g;

const QTY_LABELLED = /(?:수량|주문\s*수량|구매\s*수량|주문량)\s*[:：]?\s*(\d{1,4})/;
const QTY_UNIT =
  /(\d{1,4})\s*(개|EA|ea|Ea|세트|셋트|박스|팩|권|매|장|병|캔|통|봉|자루|다스|묶음|롤|벌|족|쌍|대|台)(?![가-힣])/;
const QTY_MULT = /[x×X]\s*(\d{1,4})\b/;

const OPTION_LINE =
  /^(\[?옵션\]?|옵션명|선택\s*옵션|색상|컬러|사이즈|규격|종류|타입|수량선택|구성)\s*[:：]?\s*(.+)$/;

/** 그 줄 전체가 수량 표시일 때만 — "네오디움 자석 2개" 같은 상품명은 걸리지 않습니다. */
const QTY_ONLY =
  /^(?:[x×X]\s*\d{1,4}|\d{1,4}\s*(?:개|EA|ea|Ea|세트|셋트|박스|팩|권|매|장|병|캔|통|봉|자루|다스|묶음|롤|벌|족|쌍|대))$/;

/** 품목의 이름이 될 수 없는 줄 — 수량·옵션 표시 */
function isMeta(line: string): boolean {
  return OPTION_LINE.test(line) || QTY_LABELLED.test(line) || QTY_ONLY.test(line.replace(/\s+/g, ""));
}

const HEADER_MAP: Array<[keyof ColumnMap, RegExp]> = [
  ["name", /^(내용|상품\s*명|품\s*명|품목|제품\s*명|물품\s*명|도서\s*명|상품|물품|명칭)$/],
  ["spec", /^(규격|사양|옵션|모델|규격\s*\/?\s*사양|세부\s*사양|형식)$/],
  ["unit", /^(단위)$/],
  ["qty", /^(수량|개수|주문\s*수량|구매\s*수량|권수|부수)$/],
  ["unitPrice", /^(예상\s*단가|단가|판매\s*가|가격|정가|단가\s*\(원\)|금액\s*\/\s*개)$/],
  ["amount", /^(예상\s*금액|금액|합계|총액|소계|공급가액|합계\s*금액)$/],
];

type ColumnMap = {
  name: number;
  spec: number;
  unit: number;
  qty: number;
  unitPrice: number;
  amount: number;
};

export type ParseResult = { items: ExtractedItem[]; warnings: string[] };

export function parseCartText(raw: string): ParseResult {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+$/gm, "");

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return { items: [], warnings: ["붙여넣은 내용이 없습니다."] };

  const table = tryTable(lines);
  if (table) return table;

  return parseLoose(lines);
}

/* ------------------------------------------------------------------ */
/* 표 형태 (엑셀·웹 표 복사)                                            */
/* ------------------------------------------------------------------ */

function tryTable(lines: string[]): ParseResult | null {
  for (const [delim, minRows] of [
    [/\t/, 2],
    [/\s*\|\s*/, 2],
  ] as Array<[RegExp, number]>) {
    const hit = lines.filter((l) => delim.test(l)).length;
    if (hit >= minRows) {
      const rows = lines
        .map((l) => l.split(delim).map((c) => c.trim()))
        .filter((cells) => cells.filter(Boolean).length >= 2);
      const parsed = rowsToItems(rows, false);
      if (parsed) return parsed;
    }
  }

  // 공백 2칸 이상으로 정렬된 표는 머리글이 확인될 때만 표로 봅니다.
  const spaced = lines.map((l) => l.split(/\s{2,}/).map((c) => c.trim()));
  if (spaced.filter((c) => c.length >= 3).length >= 2) {
    const parsed = rowsToItems(spaced, true);
    if (parsed) return parsed;
  }
  return null;
}

function rowsToItems(rows: string[][], requireHeader: boolean): ParseResult | null {
  const warnings: string[] = [];
  let map: ColumnMap | null = null;
  let start = 0;

  for (let i = 0; i < Math.min(3, rows.length); i++) {
    const found = detectHeader(rows[i]);
    if (found) {
      map = found;
      start = i + 1;
      break;
    }
  }

  if (!map) {
    if (requireHeader) return null;
    map = guessByWidth(rows);
    if (!map) return null;
    warnings.push("머리글을 찾지 못해 열 순서를 추측했습니다. 표에서 확인해 주세요.");
  }

  const items: ExtractedItem[] = [];
  for (let i = start; i < rows.length; i++) {
    const cells = rows[i];
    const pick = (idx: number) => (idx >= 0 && idx < cells.length ? cells[idx] : "");
    const name = pick(map.name);
    if (!name || /^(합계|총계|소계|총\s*금액)/.test(name)) continue;
    if (looksLikeHeader(cells)) continue;

    const qty = Math.max(1, toNumber(pick(map.qty)) || 1);
    let unitPrice = toNumber(pick(map.unitPrice));
    const amount = toNumber(pick(map.amount));
    if (!unitPrice && amount) unitPrice = Math.round(amount / qty);

    items.push({
      name: name.replace(/\s+/g, " ").trim(),
      spec: pick(map.spec).trim(),
      unit: pick(map.unit).trim(),
      qty,
      unitPrice,
    });
  }

  if (items.length === 0) return null;
  return { items, warnings };
}

function detectHeader(cells: string[]): ColumnMap | null {
  const map: ColumnMap = { name: -1, spec: -1, unit: -1, qty: -1, unitPrice: -1, amount: -1 };
  let hits = 0;
  cells.forEach((cell, idx) => {
    const c = cell.replace(/\s+/g, "");
    for (const [key, re] of HEADER_MAP) {
      if (map[key] === -1 && re.test(c)) {
        map[key] = idx;
        hits++;
        return;
      }
    }
  });
  if (hits >= 2 && map.name >= 0) return map;
  return null;
}

function looksLikeHeader(cells: string[]): boolean {
  return detectHeader(cells) !== null;
}

/** 머리글이 없을 때 열 개수로 위치를 추측합니다. */
function guessByWidth(rows: string[][]): ColumnMap | null {
  const width = mode(rows.map((r) => r.length));
  const none = { name: -1, spec: -1, unit: -1, qty: -1, unitPrice: -1, amount: -1 };
  switch (width) {
    case 6:
      return { ...none, name: 0, spec: 1, unit: 2, qty: 3, unitPrice: 4, amount: 5 };
    case 5:
      return { ...none, name: 0, spec: 1, qty: 2, unitPrice: 3, amount: 4 };
    case 4:
      return { ...none, name: 0, spec: 1, qty: 2, unitPrice: 3 };
    case 3:
      return { ...none, name: 0, qty: 1, unitPrice: 2 };
    case 2:
      return { ...none, name: 0, unitPrice: 1 };
    default:
      return null;
  }
}

function mode(nums: number[]): number {
  const count = new Map<number, number>();
  for (const n of nums) count.set(n, (count.get(n) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [n, c] of count) {
    if (c > bestCount) {
      best = n;
      bestCount = c;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* 줄글 형태 (쇼핑몰 장바구니 화면 복사)                                 */
/* ------------------------------------------------------------------ */

function parseLoose(lines: string[]): ParseResult {
  const warnings: string[] = [];
  const blocks: string[][] = [];
  let current: string[] = [];
  let hasPrice = false;
  let hasName = false;

  const flush = () => {
    if (current.length) blocks.push(current);
    current = [];
    hasPrice = false;
    hasName = false;
  };

  for (const line of lines) {
    if (NOISE.test(line)) continue;
    const priced = pricesIn(line).length > 0;
    // 수량·옵션 줄은 품목을 끊지 않습니다. ("수량 3개" 뒤에 합계가 오는 장바구니가 흔합니다)
    const nameLike = !priced && !isMeta(line) && /[가-힣A-Za-z]/.test(line) && line.length >= 2;

    // 이름과 가격이 모두 모인 뒤에 새 이름이 나오면 거기서 품목이 바뀝니다.
    if (nameLike && hasPrice && hasName) flush();

    current.push(line);
    if (priced) hasPrice = true;
    if (nameLike) hasName = true;
  }
  flush();

  const items: ExtractedItem[] = [];
  for (const block of blocks) {
    const item = blockToItem(block);
    if (item) items.push(item);
  }

  if (items.length === 0) {
    warnings.push(
      "품목을 찾지 못했습니다. 상품명과 가격이 함께 보이도록 복사했는지 확인하거나, 캡쳐 이미지를 올려 AI 분석을 사용해 보세요.",
    );
  }
  return { items, warnings };
}

function blockToItem(block: string[]): ExtractedItem | null {
  const prices: number[] = [];
  const nameCandidates: string[] = [];
  const specParts: string[] = [];
  let qty = 0;

  for (const line of block) {
    const found = pricesIn(line);
    prices.push(...found);

    const opt = line.match(OPTION_LINE);
    if (opt) {
      specParts.push(opt[2].trim());
      continue;
    }

    const labelled = line.match(QTY_LABELLED);
    if (labelled) qty = Math.max(qty, Number(labelled[1]));
    else {
      const unitQty = line.match(QTY_UNIT);
      // "10개입" 처럼 뒤에 '입'이 붙으면 수량이 아니라 규격입니다.
      if (unitQty && !line.slice(unitQty.index! + unitQty[0].length).startsWith("입")) {
        qty = Math.max(qty, Number(unitQty[1]));
      }
      const mult = line.match(QTY_MULT);
      if (mult) qty = Math.max(qty, Number(mult[1]));
    }

    if (found.length === 0 && !isMeta(line) && /[가-힣A-Za-z]/.test(line) && line.length >= 2) {
      nameCandidates.push(line);
    }
  }

  if (prices.length === 0) return null;

  const name = pickName(nameCandidates);
  if (!name) return null;

  if (qty === 0) qty = 1;
  const unitPrice = pickUnitPrice(prices, qty);
  if (!unitPrice) return null;

  return {
    name,
    spec: specParts.join(" / ").slice(0, 60),
    unit: "",
    qty,
    unitPrice,
  };
}

function pickName(candidates: string[]): string {
  const cleaned = candidates
    .map((c) => c.replace(/\s+/g, " ").trim())
    .filter((c) => c.length >= 2 && !/^\d+$/.test(c) && !NOISE.test(c));
  if (cleaned.length === 0) return "";
  // 상품명은 보통 블록에서 가장 긴 줄입니다 (판매자·브랜드명은 짧음).
  return cleaned.reduce((a, b) => (b.length > a.length ? b : a)).slice(0, 80);
}

/**
 * 정가/할인가/합계가 뒤섞여 있을 때 단가를 고릅니다.
 *  - a * qty === b 인 짝이 있으면 a 가 단가
 *  - 그 외에는 마지막(=대개 할인 적용가) 값을 단가로 봅니다.
 */
function pickUnitPrice(prices: number[], qty: number): number {
  const uniq = [...new Set(prices.filter((p) => p > 0))];
  if (uniq.length === 0) return 0;

  if (qty > 1) {
    for (const a of uniq) {
      if (uniq.some((b) => b !== a && Math.abs(a * qty - b) <= 1)) return a;
    }
  }
  if (uniq.length >= 2) {
    const [first, ...rest] = uniq;
    const last = rest[rest.length - 1];
    // 12,000원 → 10,000원 처럼 정가가 먼저 나온 경우 할인가 채택
    if (last < first) return last;
  }
  return uniq[uniq.length - 1];
}

function pricesIn(line: string): number[] {
  const out: number[] = [];
  PRICE_G.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PRICE_G.exec(line)) !== null) {
    const raw = m[1] ?? m[2];
    if (!raw) continue;
    const n = toNumber(raw);
    // 상품번호·후기 수 같은 값이 섞이지 않도록 최소한의 하한을 둡니다.
    if (n >= 10) out.push(n);
  }
  return out;
}
