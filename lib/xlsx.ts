import type { Item } from "./types";

/**
 * 업로드 서식 그대로 `.xls` 를 만듭니다. 전부 브라우저에서 만듭니다.
 *
 * 학교 시스템에 올릴 수 있어야 하므로 **형식을 마음대로 바꾸면 안 됩니다.**
 * 받은 서식 파일(품목내역.xls)을 뜯어 확인한 구조입니다.
 *
 *   - 진짜 엑셀 97~2003 파일(BIFF8). `.xlsx` 는 업로드가 되지 않습니다.
 *   - 시트 이름 `품목내역`
 *   - 첫 줄은 머리글 `내용 / 규격 / 단위 / 수량 / 예상단가` 5열
 *   - 열 너비는 다섯 열 모두 14.06자
 *
 * 서식에 **예상금액 열은 없습니다.** 수량 × 단가는 올린 뒤 시스템이 계산합니다.
 * 합계 행도 넣지 않습니다. (화면 표에는 둘 다 그대로 보입니다.)
 */

export const SHEET_NAME = "품목내역";
export const HEADERS = ["내용", "규격", "단위", "수량", "예상단가"] as const;

/** 서식의 열 너비 — 다섯 열 모두 같습니다. */
const COLUMN_WIDTH = 14.06;

export async function buildXls(items: Item[]): Promise<Blob> {
  const rows = items.filter((it) => it.name.trim().length > 0);
  if (rows.length === 0) throw new Error("내보낼 품목이 없습니다.");

  const XLSX = await import("xlsx");

  const sheet = XLSX.utils.aoa_to_sheet([
    [...HEADERS],
    ...rows.map((it) => [it.name.trim(), it.spec.trim(), it.unit.trim(), it.qty, it.unitPrice]),
  ]);
  sheet["!cols"] = HEADERS.map(() => ({ wch: COLUMN_WIDTH }));

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, SHEET_NAME);

  const raw = XLSX.write(book, { bookType: "biff8", type: "array" }) as ArrayBuffer;
  return new Blob([repack(XLSX, raw)], { type: "application/vnd.ms-excel" });
}

/**
 * `.xls` 는 하나의 덩어리가 아니라 안에 폴더가 든 상자(OLE 복합 문서)이고,
 * 그 뿌리 폴더의 이름은 관례상 `Root Entry` 입니다. 서식 원본도 그렇습니다.
 *
 * 그런데 만들어 주는 라이브러리는 뿌리를 `R` 이라고 적습니다. 요즘 프로그램은
 * 신경 쓰지 않지만, 오래된 업로드 시스템 중에는 `Root Entry` 라는 이름으로 찾는
 * 것이 있습니다. 그래서 표(Workbook)만 꺼내 상자를 다시 쌉니다.
 *
 * 라이브러리가 자기 표시용 스트림(`\x01Sh33tJ5`)을 하나 더 넣는데 이건 지워도
 * 저장할 때 다시 붙습니다. 엑셀이 만든 파일에도 이런 부속 스트림이 여럿 들어가고
 * 읽는 쪽은 표만 보므로 그대로 둡니다.
 */
function repack(XLSX: typeof import("xlsx"), raw: ArrayBuffer): ArrayBuffer {
  const CFB = XLSX.CFB;
  const workbook = CFB.find(CFB.read(new Uint8Array(raw), { type: "array" }), "/Workbook");
  if (!workbook) return raw;

  const box = CFB.utils.cfb_new({ root: "Root Entry" });
  CFB.utils.cfb_add(box, "/Workbook", workbook.content);
  return CFB.write(box, { type: "array" }) as ArrayBuffer;
}
