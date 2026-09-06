import { newId, type Attachment } from "./types";

/**
 * OCR는 글자가 클수록 잘 읽습니다. 화면 캡쳐는 대개 작으므로 줄이지 않고 키웁니다.
 * 너무 키우면 인식이 느려지므로 위아래로 한계를 둡니다.
 */
const OCR_MIN_EDGE = 1600;
const OCR_MAX_EDGE = 2600;

export function isSupported(file: File): boolean {
  return file.type.startsWith("image/");
}

export async function fileToAttachment(file: File): Promise<Attachment> {
  if (!isSupported(file)) {
    throw new Error(`${file.name || "파일"}: 이미지 파일만 올릴 수 있습니다.`);
  }
  return {
    id: newId(),
    name: file.name || "캡쳐.png",
    blob: file,
    previewUrl: URL.createObjectURL(file),
    bytes: file.size,
  };
}

/** 캡쳐를 흑백으로 바꾸고 글자 크기를 키워 OCR 정확도를 올립니다. */
export async function prepareForOcr(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const longest = Math.max(bitmap.width, bitmap.height);

  let scale = 1;
  if (longest < OCR_MIN_EDGE) scale = Math.min(3, OCR_MIN_EDGE / longest);
  else if (longest > OCR_MAX_EDGE) scale = OCR_MAX_EDGE / longest;

  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 처리할 수 없습니다.");

  // 투명 배경(잘라낸 캡쳐)이 검게 나오지 않도록 흰 바탕을 먼저 깝니다.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = "grayscale(1) contrast(1.2)";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  return new Promise<Blob>((resolve, reject) => {
    // OCR에는 손실 없는 PNG가 유리합니다.
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("이미지 변환에 실패했습니다."))),
      "image/png",
    );
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
