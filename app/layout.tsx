import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PumuiKit — 장바구니에서 품의서식으로",
  description:
    "쇼핑몰 장바구니를 붙여넣거나 캡쳐 이미지를 올리면 내용·규격·단위·수량·예상단가·예상금액 표로 정리하고, 품의서식 그대로 엑셀·CSV로 저장합니다. 서버 없이 브라우저에서만 동작합니다.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
