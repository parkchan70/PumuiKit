export function comma(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("ko-KR");
}

/** "12,000원" · "1 200" · "₩3,500" 등에서 정수만 뽑아냅니다. */
export function toNumber(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw) : 0;
  if (!raw) return 0;
  const digits = String(raw).replace(/[^\d.-]/g, "");
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function todayStamp(): string {
  const d = new Date();
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** 한글 파일명을 Content-Disposition 에 안전하게 싣기 위한 인코딩 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
