"use client";

import { useCallback, useRef, useState } from "react";
import type { Attachment } from "@/lib/types";
import { formatBytes } from "@/lib/image";

type Props = {
  text: string;
  onTextChange: (value: string) => void;
  attachments: Attachment[];
  onFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onExtract: () => void;
  onClear: () => void;
  loading: boolean;
};

export default function InputPanel({
  text,
  onTextChange,
  attachments,
  onFiles,
  onRemoveAttachment,
  onExtract,
  onClear,
  loading,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      const files: File[] = [];
      for (const item of Array.from(event.clipboardData.items)) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        // 캡쳐 이미지를 붙여넣은 경우 — 텍스트로는 들어가지 않게 막습니다.
        event.preventDefault();
        onFiles(files);
      }
    },
    [onFiles],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length > 0) onFiles(files);
    },
    [onFiles],
  );

  const hasInput = text.trim().length > 0 || attachments.length > 0;

  return (
    <section
      className="panel relative flex min-h-0 flex-col overflow-hidden p-4"
      onPaste={handlePaste}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={handleDrop}
    >
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold">1. 붙여넣기 / 캡쳐 올리기</h2>
        <button
          type="button"
          className="text-xs underline"
          style={{ color: "var(--muted)" }}
          onClick={onClear}
          disabled={!hasInput || loading}
        >
          입력 지우기
        </button>
      </header>

      <p className="mb-2 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        장바구니 화면을 <b>Ctrl+A → Ctrl+C</b> 해서 아래에 붙여넣으세요. 캡쳐 이미지는 이 칸에 바로{" "}
        <b>Ctrl+V</b> 해도 되고, 이미지 파일을 끌어다 놓아도 됩니다.
      </p>

      <textarea
        className="field min-h-[8rem] flex-1 resize-none font-mono text-xs leading-relaxed"
        placeholder={"예)\n두근두근 세계여행 (다문화 교육 카드 게임)\n12,000원\n10,000원\n수량 3개"}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        spellCheck={false}
      />

      {attachments.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs"
              style={{ borderColor: "var(--line-strong)" }}
            >
              {/* 로컬 object URL 미리보기 — next/image 최적화 대상이 아닙니다. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={att.previewUrl}
                alt=""
                className="h-9 w-9 rounded object-cover"
                style={{ border: "1px solid var(--line)" }}
              />
              <span className="max-w-[10rem] truncate">{att.name}</span>
              <span style={{ color: "var(--muted)" }}>{formatBytes(att.bytes)}</span>
              <button
                type="button"
                aria-label={`${att.name} 빼기`}
                className="ml-1 rounded px-1 font-bold"
                style={{ color: "var(--muted)" }}
                onClick={() => onRemoveAttachment(att.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn"
          onClick={() => fileInput.current?.click()}
          disabled={loading}
        >
          캡쳐 이미지 선택
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onFiles(files);
            e.target.value = "";
          }}
        />

        <button
          type="button"
          className="btn btn-primary ml-auto"
          onClick={onExtract}
          disabled={!hasInput || loading}
        >
          {loading ? "정리하는 중…" : "표로 정리하기"}
        </button>
      </div>

      {attachments.length > 0 && (
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          캡쳐는 브라우저 안에서 글자를 읽습니다. 인터넷으로 보내지 않습니다. 상품명은 오타가 섞일
          수 있으니 표에서 확인해 주세요.
        </p>
      )}

      {dragging && (
        <div
          className="pointer-events-none absolute inset-0 grid place-items-center rounded-[14px] text-sm font-bold"
          style={{
            background: "var(--accent-soft)",
            border: "2px dashed var(--accent)",
            color: "var(--accent)",
          }}
        >
          여기에 놓으면 올라갑니다
        </div>
      )}
    </section>
  );
}
