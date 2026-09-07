import type { ExtractedItem } from "./types";
import { toNumber } from "./format";

/**
 * 규칙 기반 장바구니 파서.
 *
 * 붙여넣은 글과 캡쳐에서 읽은 글(OCR) 모두 여기로 들어옵니다.
 * 완벽할 수 없으므로 결과는 표에서 직접 고치는 것을 전제로 합니다.
 */

const NOISE =
  /^(무료\s*배송|배송비|배송\s*정보|평균\s*배송|합\s*배송|도착\s*예정|오늘출발|내일도착|장바구니|전체\s*선택|선택\s*삭제|삭제|찜하기|공유|더보기|바로\s*구매|구매하기|장바구니\s*담기|옵션\s*변경|쿠폰|적립|포인트|마일리지|리뷰|후기|판매자|브랜드|상품\s*번호|주문\s*금액|총\s*결제|결제\s*예정|할인\s*금액|즉시\s*할인|총\s*상품\s*금액|소계|총\s*합계|합계|총계|배송\s*예정|재입고|품절|수량\s*변경|주문서|안내|카드|무이자)/;

/**
 * 캡쳐에서는 줄 아무 데나 이 말이 들어 있으면 그 줄을 통째로 버립니다.
 * 상품 사진 속 글씨가 오른쪽 정보와 한 줄로 붙어 들어오기 때문에
 * 줄 첫머리만 보는 NOISE 로는 걸러지지 않습니다.
 */
const NOISE_ANYWHERE =
  /(무료\s*배송|배송비|배송\s*정보|배송\s*예정|발송\s*예정|평균\s*배송|합\s*배송|도착\s*예정|적립\s*혜택|적립금|포인트|마일리지|학교\s*예산|(?:후기|리뷰)\s*\d+\s*건|총\s*결제|결제\s*예정|총\s*상품\s*금액|주문\s*금액|상품\s*번호|판매자|무이자|관심\s*상품|장바구니\s*담기)/;

/**
 * "12,000원" · "₩12,000" · "12000 원", 그리고 천 단위 쉼표가 있는 숫자.
 *
 * OCR은 "원"을 8 · 2! · e# 처럼 자주 잘못 읽습니다. 그래서 세 번째 갈래로
 * 쉼표로 끊어진 숫자를 가격으로 받아 줍니다. 다만 "1,000ml" · "1,000개"처럼
 * 단위가 붙은 것은 가격이 아니므로 걸러냅니다.
 */
const PRICE_G =
  /(?:₩\s*(\d{1,3}(?:,\d{3})*|\d+)|(\d{1,3}(?:,\d{3})+|\d+)\s*원|(\d{1,3}(?:,\d{3})+)(?!\s*(?:ml|mL|g|kg|cc|mm|cm|km|매|장|권|개|세트|셋트|박스|팩)))/g;

/**
 * 쇼핑몰 광고·배송 안내 줄. 어느 위치에 있든 그 줄을 통째로 버립니다.
 * ("9월 22일까지 한가위 빅세일 쿠폰으로 구매하세요!" 처럼 상품명보다 긴 문구가
 *  상품명 자리를 빼앗기 때문에, 줄 첫머리만 보는 NOISE 로는 부족합니다.)
 */
const PROMO =
  /(쿠폰|빅\s*세일|결제\s*할인|즉시\s*할인|추가\s*할인|카드\s*할인|적립|도착\s*보장|배송\s*보장|스타\s*배송|로켓\s*배송|무료\s*배송|배송비|저렴해졌|가격\s*인하|구매하세요|적용해보세요|담아보세요|품절|재입고|와우\s*회원|한정\s*수량|남았어요|상품\s*이미지|대표\s*이미지|이미지\s*없음|배너)/;

/* ------------------------------------------------------------------ */
/* 배송비 · 주문 요약 칸                                                 */
/* ------------------------------------------------------------------ */

/**
 * 배송비는 품목이 아니지만 품의서에는 적어야 하는 돈입니다.
 * 그래서 그냥 지우지 않고 이 표시로 바꿔 둔 뒤, 그 배송비가 딸린 품목
 * **바로 아래**에 `배송비` 행으로 되살립니다.
 * (지워 버리면 어느 품목에 붙은 배송비인지 알 수 없게 됩니다.)
 */
const SHIP_MARK = "\u0000SHIP:";

function shipMark(fee: number): string {
  return SHIP_MARK + Math.max(0, Math.round(fee));
}

/** 배송비 표시면 금액(무료는 0)을, 아니면 null 을 돌려줍니다. */
function shipFeeOf(line: string): number | null {
  if (!line.startsWith(SHIP_MARK)) return null;
  const n = Number(line.slice(SHIP_MARK.length));
  return Number.isFinite(n) ? n : null;
}

const FREE_SHIPPING = /^(?:무료\s*배송|배송비\s*무료)$/;
const SHIPPING_LABEL = /^(?:묶음|합|기본|조건부|추가)?\s*배송비/;

/** 금액만 적힌 줄 — "3,000원" · "₩3,000" · "45,000" */
const PRICE_ONLY = /^₩?\s*\d{1,3}(?:,\d{3})*\s*원?$/;

/**
 * 한 줄 안에서 **"배송비" 바로 뒤에 붙은** 금액만 집어냅니다.
 * 요약 칸은 "상품금액 42,000원 − 할인금액 0원 + 배송비 3,000원 = 주문금액 45,000원"처럼
 * 한 줄에 금액이 여럿 들어오므로, 줄에서 아무 금액이나 고르면 주문금액을 배송비로
 * 착각합니다.
 */
const SHIPPING_FEE_IN_LINE = /배송비\s*[:：]?\s*(₩?\s*\d{1,3}(?:,\d{3})*\s*원?|무료)/;

function shippingFeeIn(line: string): number | null {
  const m = line.replace(/\s+/g, " ").match(SHIPPING_FEE_IN_LINE);
  if (!m) return null;
  if (m[1] === "무료") return 0;
  const [fee] = pricesIn(m[1]);
  return fee ?? 0;
}

/**
 * "배송비 3,000원" · "무료배송" 처럼 배송비만 적힌 줄을 표시로 바꿉니다.
 * 캡쳐에서 "배송비        3,000원" 처럼 칸이 벌어져 있어도, 칸을 가르기 **전에**
 * 여기서 잡으므로 라벨과 금액이 갈라질 일이 없습니다.
 * ("배송비 3만원 이상 무료" 같은 안내는 금액을 못 읽지만 품목도 아니므로 무료로 둡니다.)
 */
function toShipMark(line: string): string | null {
  const t = line.replace(/\s+/g, " ").trim();
  if (FREE_SHIPPING.test(t)) return shipMark(0);
  if (!SHIPPING_LABEL.test(t)) return null;
  return shipMark(shippingFeeIn(t) ?? 0);
}

/**
 * 판매자별 주문 요약 칸에 나오는 라벨.
 * ("상품금액 − 할인금액 + 배송비 = 주문금액" 줄)
 */
const SUMMARY_LABEL =
  /(상품\s*금액|할인\s*금액|주문\s*금액|결제\s*금액|총\s*금액|배송비|배송\s*금액|소\s*계|합\s*계|총\s*계|담은\s*장바구니|적립)/;

/** 요약 칸이 시작되는 줄 */
const SUMMARY_START =
  /(상품\s*금액|주문\s*금액|결제\s*금액|총\s*금액|담은\s*장바구니|상품\s*소\s*계)/;

/**
 * −, +, = 아이콘에 붙은 대체 텍스트.
 * 화면에는 기호로 보이지만 복사하면 글자로 따라오고, 값에 그대로 붙어
 * "0원더하기"(할인금액 0원 + 배송비) 같은 줄이 만들어집니다.
 */
const SYMBOL_WORDS = /(빼기|더하기|같음|곱하기|나누기|플러스|마이너스|이퀄)/g;

function isSummaryLine(line: string): boolean {
  if (shipFeeOf(line) !== null) return true;
  const t = line
    .replace(SYMBOL_WORDS, " ")
    .replace(/[−–—+=×]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return true;
  if (SUMMARY_LABEL.test(t)) return true;
  return PRICE_ONLY.test(t);
}

/**
 * 판매자별 주문 요약 칸을 통째로 걷어냅니다.
 *
 * 이 칸은 줄 첫머리만 보는 NOISE 로는 걸러지지 않습니다.
 * "유앤아이i에서 담은 장바구니 상품 소계" 는 상품명처럼 생겼고,
 * "0원더하기" 는 라벨이 다 떨어져 나가고 값만 남은 조각이라
 * 그대로 두면 둘 다 품목 행이 되어 버립니다.
 *
 * 요약 칸의 배송비는 버리지 않고 표시로 바꿔 그 자리에 남깁니다.
 * (판매자 칸에 배송비가 따로 적혀 있지 않은 장바구니도 있기 때문입니다.
 *  두 군데 모두 있으면 같은 블록 안에서 큰 값 하나만 씁니다.)
 */
function stripSummary(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!SUMMARY_START.test(lines[i]) || !isSummaryLine(lines[i])) {
      out.push(lines[i]);
      continue;
    }
    let fee = 0;
    let j = i;
    while (j < lines.length && isSummaryLine(lines[j])) {
      const marked = shipFeeOf(lines[j]) ?? shippingFeeIn(lines[j]);
      if (marked !== null) fee = Math.max(fee, marked);
      j++;
    }
    if (fee > 0) out.push(shipMark(fee));
    i = j - 1;
  }
  return out;
}

const QTY_LABELLED = /(?:수량|주문\s*수량|구매\s*수량|주문량)\s*[:：]?\s*(\d{1,4})/;

/** 가격 옆에 붙는 "× 3" — "10,000원 x 3개" */
const QTY_MULT = /[x×X]\s*(\d{1,4})\b/;

// "색상 | 순향 용기 1개 + 리필 3개" 처럼 막대(|)로 구분되는 장바구니도 받습니다.
const OPTION_LINE =
  /^(\[?옵션\]?|옵션명|선택\s*옵션|선택\s*정보|색상|컬러|사이즈|규격|종류|타입|수량선택|구성)\s*[:：|｜]?\s*(.+)$/;

const QTY_UNITS = "개|EA|ea|Ea|세트|셋트|박스|팩|권|매|장|병|캔|통|봉|자루|다스|묶음|롤|벌|족|쌍|대";

/**
 * 줄 **전체**가 수량 표시일 때만 그 숫자를 돌려줍니다.
 *
 * 장바구니의 수량 조절 칸은 "− 1 +" 또는 "1" 한 줄로 복사됩니다.
 * 반대로 상품명 안의 "30롤" · "2팩" · "202.5g x 3개" 는 규격이지 주문 수량이 아니므로,
 * 줄 일부만 맞는 경우는 절대 수량으로 보지 않습니다.
 */
function quantityOnly(line: string): number | null {
  const compact = line
    // 화면의 −/+ 단추가 "빼기 10 더하기" 처럼 글자로 복사되는 장바구니가 있습니다.
    .replace(SYMBOL_WORDS, "")
    .replace(/\s+/g, "")
    .replace(/^[-−–—+]+/, "")
    .replace(/[-−–—+]+$/, "");
  if (!compact) return null;
  const m = compact.match(new RegExp(`^(?:[x×X](\\d{1,4})|(\\d{1,4})(?:${QTY_UNITS})?)$`));
  if (!m) return null;
  const n = Number(m[1] ?? m[2]);
  return Number.isFinite(n) && n > 0 && n <= 9999 ? n : null;
}

/** 품목의 이름이 될 수 없는 줄 — 수량·옵션 표시 */
function isMeta(line: string): boolean {
  return OPTION_LINE.test(line) || QTY_LABELLED.test(line) || quantityOnly(line) !== null;
}

/**
 * 캡쳐의 상품 사진에서 나온 의미 없는 글자 조각인지 봅니다.
 * ("h > Co", "Hi 그", "aa", "4 Nee" 같은 것들)
 */
function isGarbage(line: string): boolean {
  const compact = line.replace(/\s+/g, "");
  if (compact.length < 2) return true;
  const meaningful = (compact.match(/[가-힣0-9A-Za-z]/g) ?? []).length;
  if (meaningful < compact.length * 0.6) return true;
  const hangul = (compact.match(/[가-힣]/g) ?? []).length;
  if (hangul >= 2) return false;
  // 한글이 거의 없다면 알파벳 단어라도 뚜렷해야 글자로 인정합니다.
  return !/[A-Za-z]{4,}/.test(compact);
}

/**
 * 캡쳐는 왼쪽 사진과 오른쪽 정보가 한 줄로 붙어 나옵니다.
 * 칸 사이는 공백이 아주 넓게 벌어지므로 그 지점에서 잘라 줍니다.
 * (같은 줄 안의 "배송비    3,000원" 같은 좁은 간격은 그대로 둡니다.)
 */
const COLUMN_GAP = /\s{8,}/;

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

export type ParseOptions = {
  /** 캡쳐를 OCR로 읽은 글이면 켭니다. 잡음 제거를 훨씬 세게 겁니다. */
  ocr?: boolean;
};

export function parseCartText(raw: string, options: ParseOptions = {}): ParseResult {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")  // 줄바꿈 없는 공백(NBSP)
    .replace(/[ \t]+$/gm, "");

  // 주문 요약 칸을 가장 먼저 걷어냅니다. 여기에는 상품명처럼 생긴 라벨과
  // 기호의 대체 텍스트가 섞여 있어, 뒤로 미루면 품목 행으로 굳어 버립니다.
  let lines = stripSummary(text.split("\n"));
  // 배송비는 버리지 않고 표시로 바꿔 자리를 지켜 둡니다. 칸을 가르기 전에 잡아야
  // "배송비        3,000원" 의 라벨과 금액이 갈라지지 않습니다.
  lines = lines.map((line) => toShipMark(line) ?? line);
  // 광고 문구는 붙여넣기·캡쳐 어느 쪽이든 걷어냅니다.
  lines = lines.filter((line) => shipFeeOf(line) !== null || !PROMO.test(line));

  if (options.ocr) {
    lines = lines
      // 잡음 판정은 반드시 자르기 "전에" 합니다.
      .filter((line) => shipFeeOf(line) !== null || !NOISE_ANYWHERE.test(line))
      // 그다음 사진 칸과 정보 칸을 가르고, 남은 글자 조각을 버립니다.
      .flatMap((line) => (shipFeeOf(line) !== null ? [line] : line.split(COLUMN_GAP)))
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .filter(
        (l) =>
          shipFeeOf(l) !== null ||
          pricesIn(l).length > 0 ||
          // "- 10 +" 같은 수량 칸은 글자가 거의 없어 조각으로 오해받지만 꼭 필요합니다.
          quantityOnly(l) !== null ||
          !isGarbage(l),
      );
  } else {
    lines = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  }

  if (lines.every((l) => shipFeeOf(l) !== null)) {
    return {
      items: [],
      warnings: [options.ocr ? "캡쳐에서 글자를 찾지 못했습니다." : "붙여넣은 내용이 없습니다."],
    };
  }

  // 캡쳐 결과는 칸이 반듯하지 않아 표로 보지 않습니다.
  if (!options.ocr) {
    const table = tryTable(lines);
    if (table) return table;
  }

  const result = parseLoose(lines);
  if (options.ocr && result.items.length > 0) {
    result.warnings.push(
      "캡쳐에서 읽은 값입니다. 상품명과 가격에 오타가 섞일 수 있으니 표에서 확인해 주세요.",
    );
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* 표 형태 (엑셀·웹 표 복사)                                            */
/* ------------------------------------------------------------------ */

function tryTable(all: string[]): ParseResult | null {
  // 배송비 표시는 표의 칸이 아니므로 표 판정에서 빼 둡니다.
  const lines = all.filter((l) => shipFeeOf(l) === null);
  for (const [delim, minRows] of [
    [/\t/, 2],
    [/\s*\|\s*/, 2],
  ] as Array<[RegExp, number]>) {
    const hit = lines.filter((l) => delim.test(l)).length;
    // 구분자가 대부분의 줄에 있어야 표로 봅니다.
    // 장바구니에도 "색상 | 순향 용기 1개" 같은 줄이 한둘 섞이는데,
    // 그걸 표로 오인하면 장바구니 전체가 엉망이 됩니다.
    if (hit >= minRows && hit >= lines.length * 0.6) {
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
/* 줄글 형태 (쇼핑몰 장바구니 화면 복사 · 캡쳐 인식 결과)                 */
/* ------------------------------------------------------------------ */

type Block = { lines: string[]; shipping: number };

function parseLoose(lines: string[]): ParseResult {
  const warnings: string[] = [];
  const blocks: Block[] = [];
  let current: string[] = [];
  let shipping = 0;
  let hasPrice = false;
  let hasName = false;

  const flush = () => {
    if (current.length || shipping > 0) blocks.push({ lines: current, shipping });
    current = [];
    shipping = 0;
    hasPrice = false;
    hasName = false;
  };

  for (const line of lines) {
    // 배송비는 품목을 끊지 않습니다. 같은 판매자 칸에 두 번(품목 옆 · 요약 칸) 적혀 있어도
    // 큰 값 하나만 남겨 두 번 더해지지 않게 합니다.
    const fee = shipFeeOf(line);
    if (fee !== null) {
      shipping = Math.max(shipping, fee);
      continue;
    }
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
    const item = blockToItem(block.lines, warnings);
    if (item) items.push(item);
    if (block.shipping <= 0) continue;
    // 배송비는 그 배송비가 딸린 품목 **바로 아래**에 붙입니다.
    // 품목을 못 읽은 블록(요약 칸만 남은 경우)의 배송비는 바로 앞 품목의 것으로 봅니다.
    if (item || items.length > 0) {
      items.push({ name: "배송비", spec: "", unit: "", qty: 1, unitPrice: block.shipping });
    }
  }

  if (items.length === 0) {
    warnings.push(
      "품목을 찾지 못했습니다. 상품명과 가격이 함께 보이도록 복사하거나 캡쳐했는지 확인해 주세요.",
    );
  }
  return { items, warnings };
}

function blockToItem(block: string[], warnings: string[]): ExtractedItem | null {
  const prices: number[] = [];
  const nameCandidates: string[] = [];
  const specParts: string[] = [];

  // 수량은 출처에 따라 믿음의 정도가 다릅니다. 아래 순서로 채택합니다.
  let labelledQty = 0; // "수량 3개"
  let multQty = 0; // "10,000원 × 3"
  let steppedQty = 0; // 장바구니 수량 칸이 "− 1 +" / "1" 한 줄로 복사된 경우

  for (const line of block) {
    const found = pricesIn(line);
    prices.push(...found);

    const opt = line.match(OPTION_LINE);
    if (opt) {
      specParts.push(opt[2].trim());
      continue;
    }

    const labelled = line.match(QTY_LABELLED);
    if (labelled) {
      labelledQty = Math.max(labelledQty, Number(labelled[1]));
    } else if (found.length > 0) {
      const mult = line.match(QTY_MULT);
      if (mult) multQty = Math.max(multQty, Number(mult[1]));
    } else {
      // 줄 전체가 수량일 때만. 상품명 안의 "30롤"·"2팩"·"x 3개"는 규격이므로 건드리지 않습니다.
      const only = quantityOnly(line);
      if (only !== null && steppedQty === 0) steppedQty = only;
    }

    if (found.length === 0 && !isMeta(line) && /[가-힣A-Za-z]/.test(line) && line.length >= 2) {
      nameCandidates.push(line);
    }
  }

  if (prices.length === 0) return null;

  const name = pickName(nameCandidates);
  if (!name) return null;

  const qty = labelledQty || multQty || steppedQty || 1;
  // 장바구니 수량 칸에서 수량을 읽었다면, 화면의 금액은 그 줄의 "합계"입니다.
  const priceIsLineTotal = !labelledQty && !multQty && steppedQty > 1;
  const unitPrice = pickUnitPrice(prices, qty, priceIsLineTotal, name, warnings);
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
 *
 *  1. 단가와 합계가 함께 보이면 (단가 × 수량 = 합계) 짝을 찾아 단가를 씁니다.
 *  2. 남은 값 중 마지막 것을 고릅니다. 정가가 먼저 나오고 할인가가 뒤에 오므로
 *     대개 실제 결제가입니다.
 *  3. `lineTotal` 이면 그 값은 단가가 아니라 그 줄의 합계이므로 수량으로 나눕니다.
 *     장바구니는 "− 4 +" 옆에 4개 합계(70,400원)를 보여 주지 단가를 보여 주지 않습니다.
 */
function pickUnitPrice(
  prices: number[],
  qty: number,
  lineTotal: boolean,
  name: string,
  warnings: string[],
): number {
  const uniq = [...new Set(prices.filter((p) => p > 0))];
  if (uniq.length === 0) return 0;

  if (qty > 1) {
    for (const a of uniq) {
      if (uniq.some((b) => b !== a && Math.abs(a * qty - b) <= 1)) return a;
    }
  }

  const picked = uniq[uniq.length - 1];
  if (!lineTotal || qty <= 1) return picked;

  const unit = Math.round(picked / qty);
  if (unit * qty !== picked) {
    warnings.push(
      `${name.slice(0, 20)}…: 장바구니 금액 ${picked.toLocaleString("ko-KR")}원이 수량 ${qty}개로 딱 나누어떨어지지 않아 단가를 ${unit.toLocaleString("ko-KR")}원으로 반올림했습니다. 금액을 확인해 주세요.`,
    );
  }
  return unit;
}

function pricesIn(line: string): number[] {
  const out: number[] = [];
  PRICE_G.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PRICE_G.exec(line)) !== null) {
    const raw = m[1] ?? m[2] ?? m[3];
    if (!raw) continue;
    const n = toNumber(raw);
    // 상품번호·후기 수 같은 값이 섞이지 않도록 최소한의 하한을 둡니다.
    if (n >= 10) out.push(n);
  }
  return out;
}
