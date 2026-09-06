import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-opus-5";

const EFFORT = (() => {
  const v = (process.env.PUMUI_EFFORT ?? "medium").toLowerCase();
  return (["low", "medium", "high", "xhigh", "max"] as const).includes(v as never)
    ? (v as "low" | "medium" | "high" | "xhigh" | "max")
    : "medium";
})();

const SYSTEM = `당신은 한국 학교의 지출 품의(구매 품의) 담당자를 돕는 도구입니다.
사용자가 준 쇼핑몰 장바구니 캡쳐, 상품 상세 화면 캡쳐, 견적서 PDF, 또는 복사한 텍스트에서
품의서에 들어갈 품목 내역을 뽑아내는 것이 유일한 임무입니다.

각 품목마다 다음을 채웁니다.
- name(내용): 상품명. 쇼핑몰 광고 문구·수식어("무료배송", "당일출고", "[특가]", "BEST" 등)는 걷어내고
  실제 물품을 알아볼 수 있는 이름만 남깁니다. 브랜드가 물품 구분에 필요하면 앞에 둡니다.
- spec(규격): 옵션·용량·크기·색상·입수·모델명처럼 물품을 특정하는 정보.
  예) "12인용", "10개입(16cm)", "5호", "12mm", "A4 80g", "빨강". 없으면 빈 문자열.
- unit(단위): 개, 세트, 권, 박스, 팩, 매, 병, 자루 등. 확실하지 않으면 빈 문자열.
- qty(수량): 주문 수량. 화면에 없으면 1.
- unitPrice(예상단가): 실제로 결제할 1개당 가격(원). 정수만.

규칙
1. 정가에 취소선이 있고 할인가가 따로 보이면 할인가(실제 결제가)를 단가로 씁니다.
2. "10,000원 × 3개 = 30,000원" 처럼 합계가 함께 보이면 단가는 10000, 수량은 3입니다.
   합계를 단가 칸에 넣지 마세요.
3. 배송비, 쿠폰, 적립금, 포인트, 총 결제금액, 부가세 행은 품목이 아닙니다. 제외하고,
   배송비가 보이면 warnings 에 "배송비 3,000원 별도" 처럼 적어 주세요.
4. 같은 상품이 여러 옵션으로 담겨 있으면 옵션마다 따로 한 줄씩 만듭니다.
5. 화면에 보이는 순서를 그대로 유지합니다.
6. 가격이나 수량이 흐릿해서 읽기 어려우면 추측하지 말고 그 품목을 warnings 에 적어 주세요.
   (단가는 0으로 두고 사용자가 채우게 합니다.)
7. 값을 지어내지 않습니다. 자료에 없는 품목은 만들지 않습니다.

warnings 는 사용자가 확인해야 할 점을 한국어 한 문장씩 담습니다. 없으면 빈 배열.`;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      description: "품의서에 들어갈 품목 목록",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "내용(상품명)" },
          spec: { type: "string", description: "규격. 없으면 빈 문자열" },
          unit: { type: "string", description: "단위. 없으면 빈 문자열" },
          qty: { type: "integer", minimum: 1, description: "수량" },
          unitPrice: { type: "integer", minimum: 0, description: "예상단가(원)" },
        },
        required: ["name", "spec", "unit", "qty", "unitPrice"],
        additionalProperties: false,
      },
    },
    warnings: {
      type: "array",
      description: "사용자가 확인해야 할 점",
      items: { type: "string" },
    },
  },
  required: ["items", "warnings"],
  additionalProperties: false,
} as const;

type IncomingFile = { name?: string; mediaType?: string; data?: string };

export function GET() {
  return NextResponse.json({ aiAvailable: Boolean(process.env.ANTHROPIC_API_KEY) });
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "AI 분석이 설정되지 않았습니다. 배포 환경에 ANTHROPIC_API_KEY 를 등록해 주세요. (텍스트 붙여넣기는 규칙 분석으로 계속 쓸 수 있습니다.)",
        code: "no_api_key",
      },
      { status: 503 },
    );
  }

  let body: { text?: string; files?: IncomingFile[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  const files = (body.files ?? []).filter((f) => f?.data && f?.mediaType);

  if (!text && files.length === 0) {
    return NextResponse.json(
      { error: "분석할 내용이 없습니다. 장바구니를 붙여넣거나 캡쳐·PDF를 올려 주세요." },
      { status: 400 },
    );
  }

  const content: Anthropic.ContentBlockParam[] = [];

  for (const file of files) {
    if (file.mediaType === "application/pdf") {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: file.data! },
      });
    } else if (isImageMedia(file.mediaType!)) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: file.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: file.data!,
        },
      });
    }
  }

  content.push({
    type: "text",
    text: text
      ? `아래는 사용자가 붙여넣은 장바구니 내용입니다. 위에 올린 자료가 있다면 함께 보고 품목을 뽑아 주세요.\n\n---\n${text}\n---`
      : "올린 자료에서 품목을 뽑아 주세요.",
  });

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: {
        effort: EFFORT,
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "이 자료는 분석할 수 없습니다. 다른 캡쳐로 시도해 주세요." },
        { status: 422 },
      );
    }

    const raw = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const parsed = safeParse(raw);
    if (!parsed) {
      return NextResponse.json(
        { error: "결과를 해석하지 못했습니다. 다시 시도해 주세요." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      items: normalizeItems(parsed.items),
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter(isNonEmpty) : [],
      source: "ai",
    });
  } catch (error) {
    return NextResponse.json({ error: describe(error) }, { status: statusOf(error) });
  }
}

function isImageMedia(mediaType: string): boolean {
  return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeParse(raw: string): { items?: unknown; warnings?: unknown } | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeItems(items: unknown) {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => {
      const row = it as Record<string, unknown>;
      const name = String(row.name ?? "").trim();
      if (!name) return null;
      const qty = Math.max(1, Math.round(Number(row.qty) || 1));
      const unitPrice = Math.max(0, Math.round(Number(row.unitPrice) || 0));
      return {
        name,
        spec: String(row.spec ?? "").trim(),
        unit: String(row.unit ?? "").trim(),
        qty,
        unitPrice,
      };
    })
    .filter((it): it is NonNullable<typeof it> => it !== null);
}

function statusOf(error: unknown): number {
  if (error instanceof Anthropic.RateLimitError) return 429;
  if (error instanceof Anthropic.AuthenticationError) return 401;
  if (error instanceof Anthropic.APIConnectionError) return 504;
  if (error instanceof Anthropic.APIError) return error.status;
  return 500;
}

function describe(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError)
    return "요청이 몰렸습니다. 잠시 뒤 다시 눌러 주세요.";
  if (error instanceof Anthropic.AuthenticationError)
    return "ANTHROPIC_API_KEY 가 올바르지 않습니다. 배포 환경 변수를 확인해 주세요.";
  if (error instanceof Anthropic.APIConnectionError)
    return "분석 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
  if (error instanceof Anthropic.APIError)
    return `분석에 실패했습니다. (${error.status}) ${error.message}`;
  return error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
}
