"use client";

import { useState } from "react";
import { amountOf, totalOf, type Item } from "@/lib/types";
import { comma, toNumber } from "@/lib/format";

type Props = {
  items: Item[];
  /**
   * 항상 직전 값을 기준으로 고치기 위해 setState 를 그대로 받습니다.
   * (+ 를 연달아 누르면 한 번의 렌더 안에서 여러 번 처리되는데,
   *  props 의 items 를 붙잡고 계산하면 마지막 한 번만 반영됩니다.)
   */
  onChange: React.Dispatch<React.SetStateAction<Item[]>>;
};

export default function ItemTable({ items, onChange }: Props) {
  const patch = (id: string, changes: Partial<Item>) =>
    onChange((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)));

  const bumpQty = (id: string, delta: number) =>
    onChange((prev) =>
      prev.map((it) => (it.id === id ? { ...it, qty: Math.max(1, it.qty + delta) } : it)),
    );

  const remove = (id: string) => onChange((prev) => prev.filter((it) => it.id !== id));

  const move = (index: number, delta: number) =>
    onChange((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const total = totalOf(items);
  const totalQty = items.reduce((sum, it) => sum + it.qty, 0);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="sheet">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th className="min-w-[13rem] text-left">내용</th>
              <th className="min-w-[7rem]">규격</th>
              <th className="w-16">단위</th>
              <th className="w-28">수량</th>
              <th className="w-28">예상단가</th>
              <th className="w-28">예상금액</th>
              <th className="w-16"> </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id}>
                <td
                  className="text-center text-xs tabular-nums"
                  style={{ color: "var(--muted)" }}
                >
                  {index + 1}
                </td>
                <td>
                  <input
                    className="cell-input"
                    value={item.name}
                    placeholder="상품명"
                    onChange={(e) => patch(item.id, { name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="cell-input"
                    value={item.spec}
                    placeholder="—"
                    onChange={(e) => patch(item.id, { spec: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="cell-input text-center"
                    value={item.unit}
                    placeholder="개"
                    onChange={(e) => patch(item.id, { unit: e.target.value })}
                  />
                </td>
                <td>
                  <div className="flex items-center justify-center gap-0.5">
                    <StepButton
                      label="수량 줄이기"
                      onClick={() => bumpQty(item.id, -1)}
                      disabled={item.qty <= 1}
                    >
                      −
                    </StepButton>
                    <NumberCell
                      value={item.qty}
                      onCommit={(v) => patch(item.id, { qty: Math.max(1, v) })}
                      className="w-10 text-center"
                    />
                    <StepButton label="수량 늘리기" onClick={() => bumpQty(item.id, 1)}>
                      +
                    </StepButton>
                  </div>
                </td>
                <td>
                  <NumberCell
                    value={item.unitPrice}
                    onCommit={(v) => patch(item.id, { unitPrice: Math.max(0, v) })}
                  />
                </td>
                <td className="px-2 text-right text-[0.8125rem] font-semibold tabular-nums">
                  {comma(amountOf(item))}
                </td>
                <td>
                  <div className="flex items-center justify-end gap-0.5 pr-1">
                    <IconButton label="위로" onClick={() => move(index, -1)} disabled={index === 0}>
                      ▲
                    </IconButton>
                    <IconButton
                      label="아래로"
                      onClick={() => move(index, 1)}
                      disabled={index === items.length - 1}
                    >
                      ▼
                    </IconButton>
                    <IconButton label="행 삭제" onClick={() => remove(item.id)}>
                      ×
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4} className="px-2 py-2 text-right text-xs font-bold">
                  합계
                </td>
                <td className="px-2 text-center text-xs font-semibold tabular-nums">
                  {comma(totalQty)}
                </td>
                <td />
                <td className="px-2 text-right text-sm font-bold tabular-nums">{comma(total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>

        {items.length === 0 && (
          <p
            className="px-4 py-16 text-center text-sm leading-relaxed"
            style={{ color: "var(--muted)" }}
          >
            아직 품목이 없습니다.
            <br />
            왼쪽에 장바구니를 붙여넣거나 캡쳐 이미지를 올린 뒤 <b>표로 정리하기</b>를 눌러 주세요.
          </p>
        )}
      </div>
    </div>
  );
}

function NumberCell({
  value,
  onCommit,
  className = "text-right",
}: {
  value: number;
  onCommit: (value: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={`cell-input tabular-nums ${className}`}
      inputMode="numeric"
      value={draft ?? comma(value)}
      onFocus={() => setDraft(String(value))}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
      onBlur={() => {
        onCommit(toNumber(draft ?? String(value)));
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

/** 수량 옆의 − / + 단추 */
function StepButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-5 w-5 shrink-0 place-items-center rounded border text-xs leading-none disabled:opacity-30"
      style={{ borderColor: "var(--line-strong)" }}
    >
      {children}
    </button>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded px-1 text-[10px] leading-none disabled:opacity-25"
      style={{ color: "var(--muted)" }}
    >
      {children}
    </button>
  );
}
