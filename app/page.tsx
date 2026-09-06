"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import InputPanel from "@/components/InputPanel";
import ItemTable from "@/components/ItemTable";
import { csvToItems, itemsToCsv } from "@/lib/csv";
import { fileToAttachment, isSupported } from "@/lib/image";
import { readAttachments, warmUp } from "@/lib/ocr";
import { parseCartText } from "@/lib/parseCart";
import { buildXlsx } from "@/lib/xlsx";
import { comma, todayStamp } from "@/lib/format";
import {
  emptyItem,
  newId,
  totalOf,
  type Attachment,
  type ExtractedItem,
  type Item,
} from "@/lib/types";

export default function Page() {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [includeUnit, setIncludeUnit] = useState(false);
  const [includeTotal, setIncludeTotal] = useState(true);
  const csvInput = useRef<HTMLInputElement>(null);

  const total = useMemo(() => totalOf(items), [items]);
  const hasUnitValues = useMemo(() => items.some((it) => it.unit.trim().length > 0), [items]);

  const addFiles = useCallback(async (files: File[]) => {
    setError("");
    const accepted = files.filter(isSupported);
    if (accepted.length === 0) {
      setError("이미지 파일만 올릴 수 있습니다.");
      return;
    }
    try {
      const made = await Promise.all(accepted.map(fileToAttachment));
      setAttachments((prev) => [...prev, ...made]);
      // 사용자가 버튼을 누르기 전에 미리 인식 엔진을 데워 둡니다.
      warmUp();
    } catch (e) {
      setError(e instanceof Error ? e.message : "파일을 처리하지 못했습니다.");
    }
  }, []);

  const removeAttachment = (id: string) =>
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });

  const clearInput = () => {
    attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    setAttachments([]);
    setText("");
    setError("");
    setWarnings([]);
  };

  const extract = async () => {
    setError("");
    setWarnings([]);

    // 붙여넣은 글과 캡쳐에서 읽은 글은 정리 규칙이 다릅니다.
    const sources: Array<{ text: string; ocr: boolean }> = [];
    if (text.trim()) sources.push({ text, ocr: false });

    if (attachments.length > 0) {
      setLoading(true);
      setBusyLabel("글자 인식을 준비하는 중…");
      try {
        const read = await readAttachments(attachments, ({ label, ratio }) => {
          setBusyLabel(ratio > 0 ? `${label}… ${Math.round(ratio * 100)}%` : `${label}…`);
        });
        sources.push(
          ...read.filter((t) => t.trim().length > 0).map((t) => ({ text: t, ocr: true })),
        );
      } catch (e) {
        setError(e instanceof Error ? `캡쳐를 읽지 못했습니다: ${e.message}` : "캡쳐를 읽지 못했습니다.");
        return;
      } finally {
        setLoading(false);
        setBusyLabel("");
      }
    }

    if (sources.length === 0) {
      setError("읽을 내용이 없습니다.");
      return;
    }

    const found: ExtractedItem[] = [];
    const notes: string[] = [];
    for (const source of sources) {
      const result = parseCartText(source.text, { ocr: source.ocr });
      found.push(...result.items);
      notes.push(...result.warnings);
    }

    if (found.length === 0) {
      setWarnings([...new Set(notes)]);
      setError(
        attachments.length > 0
          ? "캡쳐에서 품목을 찾지 못했습니다. 상품명과 가격이 함께 보이도록 다시 캡쳐하거나 '행 추가'로 직접 입력해 주세요."
          : "품목을 찾지 못했습니다. 상품명과 가격이 함께 보이도록 복사했는지 확인해 주세요.",
      );
      return;
    }

    setItems((prev) => [...prev, ...found.map((it) => ({ ...it, id: newId() }))]);
    setWarnings([...new Set(notes)]);
  };

  const addRow = () => setItems((prev) => [...prev, emptyItem()]);

  const clearItems = () => {
    if (items.length > 0 && !confirm("표를 모두 지울까요?")) return;
    setItems([]);
    setWarnings([]);
  };

  const baseName = () => (title.trim() ? sanitizeName(title) : "품의_품목내역");

  const downloadCsv = () => {
    const blob = new Blob([itemsToCsv(items, includeTotal)], { type: "text/csv;charset=utf-8" });
    triggerDownload(blob, `${baseName()}_${todayStamp()}.csv`);
  };

  const downloadXlsx = async () => {
    setError("");
    setLoading(true);
    setBusyLabel("엑셀 파일을 만드는 중…");
    try {
      const blob = await buildXlsx(items, { includeUnit, includeTotal });
      triggerDownload(blob, `${baseName()}_${todayStamp()}.xlsx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "엑셀 파일을 만들지 못했습니다.");
    } finally {
      setLoading(false);
      setBusyLabel("");
    }
  };

  const importCsv = async (file: File) => {
    try {
      const loaded = csvToItems(await file.text());
      if (loaded.length === 0) {
        setError("CSV에서 품목을 찾지 못했습니다.");
        return;
      }
      setItems((prev) => [...prev, ...loaded]);
      setError("");
    } catch {
      setError("CSV를 읽지 못했습니다.");
    }
  };

  return (
    <main className="mx-auto flex h-screen max-w-[1500px] flex-col gap-3 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-extrabold tracking-tight">PumuiKit</h1>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          장바구니 · 캡쳐 → 품의서식 엑셀
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label
            className="whitespace-nowrap text-xs"
            style={{ color: "var(--muted)" }}
            htmlFor="doc-title"
          >
            문서 이름
          </label>
          <input
            id="doc-title"
            className="field w-56"
            placeholder="예) 2026 과학실 소모품 구입"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(340px,400px)_1fr]">
        <InputPanel
          text={text}
          onTextChange={setText}
          attachments={attachments}
          onFiles={addFiles}
          onRemoveAttachment={removeAttachment}
          onExtract={extract}
          onClear={clearInput}
          loading={loading}
        />

        <section className="panel flex min-h-0 flex-col p-4">
          <header className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold">2. 표 확인 · 수정</h2>
            <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
              {items.length}건 · 합계 {comma(total)}원
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button type="button" className="btn" onClick={addRow} disabled={loading}>
                행 추가
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => csvInput.current?.click()}
                disabled={loading}
              >
                CSV 불러오기
              </button>
              <input
                ref={csvInput}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importCsv(file);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="btn"
                onClick={clearItems}
                disabled={items.length === 0 || loading}
              >
                표 비우기
              </button>
            </div>
          </header>

          {(error || warnings.length > 0 || busyLabel) && (
            <div className="mb-3 space-y-1.5">
              {busyLabel && (
                <p
                  className="rounded-lg px-3 py-2 text-xs"
                  style={{ background: "var(--accent-soft)" }}
                >
                  {busyLabel}
                </p>
              )}
              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
              )}
              {warnings.map((w, i) => (
                <p key={i} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  확인 필요: {w}
                </p>
              ))}
            </div>
          )}

          <ItemTable items={items} onChange={setItems} />

          <footer
            className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3"
            style={{ borderColor: "var(--line)" }}
          >
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={includeUnit}
                onChange={(e) => setIncludeUnit(e.target.checked)}
              />
              엑셀에 <b>단위</b> 열 포함
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={includeTotal}
                onChange={(e) => setIncludeTotal(e.target.checked)}
              />
              합계 행 붙이기
            </label>

            <div className="ml-auto flex gap-2">
              <button
                type="button"
                className="btn"
                onClick={downloadCsv}
                disabled={items.length === 0 || loading}
              >
                CSV 저장
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={downloadXlsx}
                disabled={items.length === 0 || loading}
              >
                품의서식 엑셀 저장
              </button>
            </div>

            {!includeUnit && hasUnitValues && (
              <p className="w-full text-xs" style={{ color: "var(--muted)" }}>
                단위 값이 입력되어 있습니다. 참고 서식은 <b>내용/규격/수량/예상단가/예상금액</b> 5열
                이라 기본값에서는 단위가 빠집니다. 함께 내보내려면 위 체크를 켜세요. (CSV에는 항상
                들어갑니다.)
              </p>
            )}
          </footer>
        </section>
      </div>
    </main>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
