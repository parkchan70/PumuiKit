import { newId, type Attachment } from "./types";

/** Claude 가 보기 좋은 최대 변, 그리고 서버로 보낼 때의 용량을 함께 잡아줍니다. */
const MAX_EDGE = 1568;
const JPEG_QUALITY = 0.85;

export const MAX_TOTAL_BYTES = 3.5 * 1024 * 1024; // Vercel 요청 본문 여유분

export function isSupported(file: File): boolean {
  return file.type.startsWith("image/") || file.type === "application/pdf";
}

export async function fileToAttachment(file: File): Promise<Attachment> {
  if (file.type === "application/pdf") {
    const data = await fileToBase64(file);
    return {
      id: newId(),
      name: file.name,
      mediaType: "application/pdf",
      data,
      bytes: file.size,
    };
  }

  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name}: 이미지 또는 PDF만 올릴 수 있습니다.`);
  }

  const { base64, blob } = await downscaleImage(file);
  return {
    id: newId(),
    name: file.name || "캡쳐.jpg",
    mediaType: "image/jpeg",
    data: base64,
    previewUrl: URL.createObjectURL(blob),
    bytes: blob.size,
  };
}

async function downscaleImage(file: File): Promise<{ base64: string; blob: Blob }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 처리할 수 없습니다.");
  // 스크린샷 배경이 투명일 때 검게 나오지 않도록 흰 바탕을 깝니다.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("이미지 변환에 실패했습니다."))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
  return { base64: await blobToBase64(blob), blob };
}

function fileToBase64(file: Blob): Promise<string> {
  return blobToBase64(file);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
