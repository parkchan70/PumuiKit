import type { Worker } from "tesseract.js";
import { prepareForOcr } from "./image";
import type { Attachment } from "./types";

/**
 * 브라우저 안에서 도는 OCR. 서버도 API 키도 쓰지 않습니다.
 *
 * 워커·WASM·언어 데이터를 전부 이 사이트에서 내려주므로 외부 CDN을 부르지 않습니다.
 * (public/tesseract 는 `npm run setup:ocr`, public/tessdata 는 저장소에 들어 있습니다.)
 * 언어 데이터는 첫 실행 때 한 번만 받고 이후에는 브라우저 캐시에서 씁니다.
 */

export type OcrStage = { label: string; ratio: number };

type Sink = (stage: OcrStage) => void;

let workerPromise: Promise<Worker> | null = null;
let sink: Sink | null = null;

const STATUS_KO: Record<string, string> = {
  "loading tesseract core": "글자 인식 엔진을 불러오는 중",
  "initializing tesseract": "글자 인식 엔진을 준비하는 중",
  "loading language traineddata": "한글 데이터를 불러오는 중",
  "initializing api": "준비하는 중",
  "recognizing text": "캡쳐에서 글자를 읽는 중",
};

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker("kor+eng", 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/",
        langPath: "/tessdata",
        logger: (message: { status?: string; progress?: number }) => {
          if (!sink) return;
          const status = message.status ?? "";
          sink({
            label: STATUS_KO[status] ?? "읽는 중",
            ratio: typeof message.progress === "number" ? message.progress : 0,
          });
        },
      });
    })();
    workerPromise.catch(() => {
      // 실패한 워커를 물고 있지 않도록 비웁니다 — 다음 시도에서 새로 만듭니다.
      workerPromise = null;
    });
  }
  return workerPromise;
}

/** 캡쳐 이미지들에서 글자를 읽어 이미지 한 장당 문자열 하나로 돌려줍니다. */
export async function readAttachments(
  attachments: Attachment[],
  onStage: Sink,
): Promise<string[]> {
  sink = onStage;
  try {
    const worker = await getWorker();
    const texts: string[] = [];
    for (let i = 0; i < attachments.length; i++) {
      onStage({
        label:
          attachments.length > 1
            ? `캡쳐에서 글자를 읽는 중 (${i + 1}/${attachments.length})`
            : "캡쳐에서 글자를 읽는 중",
        ratio: 0,
      });
      const prepared = await prepareForOcr(attachments[i].blob);
      const { data } = await worker.recognize(prepared);
      texts.push(data.text ?? "");
    }
    return texts;
  } finally {
    sink = null;
  }
}

/** 탭을 눌러 두고 미리 엔진을 데워 둘 때 씁니다. 실패해도 조용히 넘어갑니다. */
export function warmUp(): void {
  void getWorker().catch(() => {});
}
