/**
 * tesseract.js 워커와 WASM 코어를 public/tesseract 로 복사합니다.
 *
 * 이렇게 두면 앱이 외부 CDN을 전혀 부르지 않습니다. (학교망에서 CDN이 막혀도 동작)
 * 용량이 커서 저장소에는 넣지 않고, 설치·빌드할 때마다 node_modules 에서 복사합니다.
 */
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const OUT = path.join(process.cwd(), "public", "tesseract");

const FILES = [
  ["tesseract.js/dist", "worker.min.js"],
  // oem=LSTM_ONLY 이므로 -lstm 변형만 필요합니다.
  // 어떤 것이 쓰일지는 브라우저의 SIMD 지원 여부에 따라 런타임에 정해집니다.
  ["tesseract.js-core", "tesseract-core-lstm.wasm.js"],
  ["tesseract.js-core", "tesseract-core-lstm.wasm"],
  ["tesseract.js-core", "tesseract-core-simd-lstm.wasm.js"],
  ["tesseract.js-core", "tesseract-core-simd-lstm.wasm"],
  ["tesseract.js-core", "tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["tesseract.js-core", "tesseract-core-relaxedsimd-lstm.wasm"],
];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

await mkdir(OUT, { recursive: true });

let copied = 0;
let missing = 0;
for (const [pkg, name] of FILES) {
  const from = path.join(process.cwd(), "node_modules", pkg, name);
  const to = path.join(OUT, name);
  if (!(await exists(from))) {
    console.warn(`[setup-ocr] 원본 없음: ${pkg}/${name}`);
    missing += 1;
    continue;
  }
  await copyFile(from, to);
  copied += 1;
}

console.log(`[setup-ocr] public/tesseract 준비 완료 (${copied}개 복사${missing ? `, ${missing}개 누락` : ""})`);
if (missing > 0) process.exitCode = 1;
