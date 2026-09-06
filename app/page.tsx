"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import InputPanel from "@/components/InputPanel";
import ItemTable from "@/components/ItemTable";
import { csvToItems, itemsToCsv } from "@/lib/csv";
import { fileToAttachment, isSupported, MAX_TOTAL_BYTES } from "@/lib/image";
import { parseCartText } from "@/lib/parseCart";
import { comma, todayStamp } from "@/lib/format";
import { newId, totalOf, type Attachment, type ExtractedItem, type Item } from "@/lib/types";

export default function Page() {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [useAi, setUseAi] = useState(true);
  const [title, setTitle] = useState("");
  const [includeUnit, setIncludeUnit] = useState(false);
  const [includeTotal, setIncludeTotal] = useState(true);
  const csvInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/extract")
      .then((r) => r.json())
      .then((d: { aiAvailable?: boolean }) => {
        if (alive) setAiAvailable(Boolean(d.aiAvailable));
      })
      .catch(() => {
        if (alive) setAiAvailable(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const total = useMemo(() => totalOf(items), [items]);
  const hasUnitValues = useMemo(() => items.some((it) => it.unit.trim().length > 0), [items]);

  const addFiles = useCallback(
    async (files: File[]) => {
      setError("");
      const accepted = files.filter(isSupported);
      if (accepted.length === 0) {
        setError("이미지 또는 PDF 파일만 올릴 수 있습니다.");
        return;
      }
      try {
        const made = await Promise.all(accepted.map(fileToAttachment));
        setAttachments((prev) => {
          const next = [...prev, ...made];
          const bytes = next.reduce((s, a) => s + a.data.length * 0.75, 0);
          if (bytes > MAX_TOTAL_BYTES) {
            setError(
              "올린 파일 용량이 너무 큽니다. 몇 개씩 나누어 분석하거나 PDF 대신 캡쳐 이미지를 써 주세요.",
            );
            return prev;
          }
          return next;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "파일을 처리하지 못했습니다.");
      }
    },
    [],
  );

  const removeAttachment = (id: string) =>
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });

  const clearInput = () => {
    attachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    setAttachments([]);
    setText("");
    setError("");
    setWarnings([]);
  };

  const appendItems = (extracted: ExtractedItem[]) => {
    const rows: Item[] = extracted.map((it) => ({ ...it, id: newId() }));
    setItems((prev) => [...prev, ...rows]);
    return rows.length;
  };

  const extract = async () => {
    setError("");
    setWarnings([]);
    const needsAi = attachments.length > 0 || (useAi && aiAvailable !== false);

    if (!needsAi) {
      const { items: parsed, warnings: warn } = parseCartText(text);
      const added = appendItems(parsed);
      setWarnings(added === 0 ? warn : warn);
      if (added === 0 && warn.length === 0) setError("품목을 찾지 못했습니다.");
      return;
    }

    setLoading(true);
    setBusyLabel(attachments.length > 0 ? "캡쳐·PDF를 읽는 중…" : "내용을 정리하는 중…");
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          files: attachments.map((a) => ({
            name: a.name,
            mediaType: a.mediaType,
            data: a.data,
          })),
        }),
      });

      const payload = (await response.json()) as {
        items?: ExtractedItem[];
        warnings?: string[];
        error?: string;
      };

      if (!response.ok) {
        // AI를 못 쓰더라도 텍스트가 있으면 규칙 분석으로 살려 줍니다.
        if (text.trim() && attachments.length === 0) {
          const { items: parsed } = parseCartText(text);
          const added = appendItems(parsed);
          setError(`${payload.error ?? "분석에 실패했습니다."} 규칙 분석으로 ${added}건 정리했습니다.`);
        } else {
          setError(payload.error ?? "분석에 실패했습니다.");
        }
        return;
      }

      const added = appendItems(payload.items ?? []);
      setWarnings(payload.warnings ?? []);
      if (added === 0) setError("자료에서 품목을 찾지 못했습니다. 다른 캡쳐로 시도해 보세요.");
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setLoading(false);
      setBusyLabel("");
    }
  };

  const addRow = () =>
    setItems((prev) => [
      ...prev,
      { id: newId(), name: "", spec: "", unit: "", qty: 1, unitPrice: 0 },
    ]);

  const clearItems = () => {
    if (items.length > 0 && !confirm("표를 모두 지울까요?")) return;
    setItems([]);
    setWarnings([]);
  };

  const baseName = () => (title.trim() ? sanitizeName(title) : "품의_품목내역");

  const downloadCsv = () => {
    const blob = new Blob([itemsToCsv(items, includeTotal)], {
      type: "text/csv;charset=utf-8",
    });
    triggerDownload(blob, `${baseName()}_${todayStamp()}.csv`);
  };

  const downloadXlsx = async () => {
    setError("");
    setLoading(true);
    setBusyLabel("엑셀 파일을 만드는 중…");
    try {
      const response = await fetch("/api/xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map(({ name, spec, unit, qty, unitPrice }) => ({
            name,
            spec,
            unit,
            qty,
            unitPrice,
          })),
          includeUnit,
          includeTotal,
          title: title.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? "엑셀 파일을 만들지 못했습니다.");
        return;
      }
      triggerDownload(await response.blob(), `${baseName()}_${todayStamp()}.xlsx`);
    } catch {
      setError("엑셀 파일을 내려받지 못했습니다.");
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
          장바구니 · 캡쳐 · PDF → 품의서식 엑셀
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="whitespace-nowrap text-xs" style={{ color: "var(--muted)" }} htmlFor="doc-title">
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
          aiAvailable={aiAvailable}
          useAi={useAi}
          onUseAiChange={setUseAi}
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
                <p className="rounded-lg px-3 py-2 text-xs" style={{ background: "var(--accent-soft)" }}>
                  {busyLabel}
                </p>
              )}
              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
              )}
              {warnings.map((w, i) => (
                <p
                  key={i}
                  className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"
                >
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
