export type Item = {
  id: string;
  /** 내용 (상품명) */
  name: string;
  /** 규격 (옵션·사양·입수 등) */
  spec: string;
  /** 단위 (개, 세트, 권 …) — 참고 서식에는 없는 열이라 내보내기는 선택 */
  unit: string;
  /** 수량 */
  qty: number;
  /** 예상단가 (원) */
  unitPrice: number;
  /** 참고 메모 — 표에는 보이지만 엑셀로는 나가지 않음 */
  note?: string;
};

export type ExtractedItem = Omit<Item, "id">;

export type ExtractResponse = {
  items: ExtractedItem[];
  warnings: string[];
  source: "ai" | "rule";
};

export type Attachment = {
  id: string;
  name: string;
  /** "image/jpeg" | "image/png" | "application/pdf" */
  mediaType: string;
  /** base64, no data: prefix */
  data: string;
  /** 미리보기용 object URL (이미지에만) */
  previewUrl?: string;
  /** 원본 바이트 크기 */
  bytes: number;
};

export const EMPTY_ITEM = (): Item => ({
  id: newId(),
  name: "",
  spec: "",
  unit: "",
  qty: 1,
  unitPrice: 0,
});

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function amountOf(item: Item): number {
  return Math.round(item.qty * item.unitPrice);
}

export function totalOf(items: Item[]): number {
  return items.reduce((sum, it) => sum + amountOf(it), 0);
}
