# PumuiKit

쇼핑몰 장바구니를 **붙여넣거나**, 캡쳐 이미지·PDF를 **끌어다 놓으면**
`내용 / 규격 / 단위 / 수량 / 예상단가 / 예상금액` 표로 정리해 주고,
학교 품의서식 그대로 **엑셀(.xlsx)** 과 **CSV** 로 저장해 주는 도구입니다.

## 쓰는 순서

1. **왼쪽 패널**에 장바구니 화면을 복사해 붙여넣습니다.
   - 캡쳐 이미지는 그 칸에 바로 <kbd>Ctrl</kbd>+<kbd>V</kbd> 해도 됩니다.
   - 캡쳐·PDF 파일을 패널 위로 끌어다 놓아도 됩니다.
2. **표로 정리하기** 를 누릅니다.
3. **오른쪽 표**에서 값을 직접 고칩니다. 합계는 즉시 다시 계산됩니다.
4. **품의서식 엑셀 저장** 또는 **CSV 저장**.

여러 번 눌러 여러 캡쳐를 이어붙일 수 있습니다(결과가 표 아래에 계속 쌓입니다).

## 만들어지는 엑셀

`품의서식참고.xls` 를 그대로 재현합니다.

| 열 | A | B | C | D | E |
|---|---|---|---|---|---|
| 머리글 | 내용 | 규격 | 수량 | 예상단가 | 예상금액 |
| 폭 | 32 | 12.5 | 6.3 | 10.4 | 10.5 |

- 머리글 굴림 9pt · 회색(C0C0C0) 채움, 본문 굴림 10pt
- 전 셀 가운데 정렬 · 실선 테두리 · 행 높이 17.4pt
- 예상금액은 값이 아니라 **수식**(`=C2*D2`)이라 엑셀에서 수량·단가를 고치면 따라 바뀝니다
- A4 세로, 여백 좌우 0.7" / 위아래 0.75", 머리글 행 인쇄 반복

체크박스 두 개로 조정할 수 있습니다.

- **단위 열 포함** — 참고 서식에는 `단위` 열이 없어 기본값은 꺼짐(5열)입니다. 켜면 6열로 나갑니다. CSV에는 항상 들어갑니다.
- **합계 행 붙이기** — 마지막에 `합계` 행(`=SUM(...)`)을 추가합니다. 기본값 켜짐.

## 품목을 읽는 두 가지 경로

| 입력 | 처리 | API 키 |
|---|---|---|
| 붙여넣은 텍스트 | 규칙 기반 파서(`lib/parseCart.ts`) 또는 AI | 규칙 파서는 불필요 |
| 캡쳐 이미지 / PDF | Claude(`claude-opus-5`) 비전·문서 입력 | **필요** |

API 키가 없으면 앱은 그대로 열리고, 텍스트 붙여넣기만 규칙 파서로 동작합니다.

## 로컬 실행

```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY 를 채웁니다
npm run dev
```

http://localhost:3000

## GitHub → Vercel 배포

```bash
git init
git add -A
git commit -m "PumuiKit 초기 버전"
git branch -M main
git remote add origin https://github.com/<계정>/PumuiKit.git
git push -u origin main
```

그 다음 [vercel.com](https://vercel.com) → **Add New… → Project** → `PumuiKit` 저장소 Import.
Framework 는 Next.js 로 자동 인식됩니다. 빌드 설정은 건드릴 것이 없습니다.

**환경 변수만 등록하면 됩니다** (Settings → Environment Variables):

| 이름 | 값 | 필수 |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | 캡쳐·PDF 분석에 필요 |
| `PUMUI_EFFORT` | `low` \| `medium` \| `high` \| `xhigh` \| `max` (기본 `medium`) | 선택 |

키를 나중에 넣었다면 Vercel에서 **Redeploy** 해야 반영됩니다.

## 구조

```
app/
  page.tsx              화면 전체 상태와 내보내기
  api/extract/route.ts  Claude 로 캡쳐·PDF·텍스트에서 품목 추출 (structured outputs)
  api/xlsx/route.ts     ExcelJS 로 품의서식 .xlsx 생성
components/
  InputPanel.tsx        붙여넣기 · 드래그앤드롭 · 첨부 목록
  ItemTable.tsx         편집 가능한 표와 실시간 합계
lib/
  parseCart.ts          API 키 없이 쓰는 규칙 기반 장바구니 파서
  csv.ts                CSV 내보내기 / 불러오기
  image.ts              캡쳐 이미지 축소(최대 1568px) 후 base64 변환
```

## 알아두면 좋은 점

- 캡쳐 이미지는 브라우저에서 긴 변 1568px, JPEG 85% 로 줄여서 보냅니다. 화질은 충분하고 전송은 가볍습니다.
- 한 번에 올리는 파일 총량은 약 3.5MB로 제한합니다(Vercel 요청 본문 한도). 넘으면 나누어 분석하세요.
- 정가에 취소선이 있고 할인가가 따로 보이면 **할인가**를 단가로 씁니다.
- 배송비·쿠폰·적립금은 품목에서 빼고, 대신 표 위에 "확인 필요" 안내로 띄웁니다.
- 값을 지어내지 않도록 프롬프트에 못박아 두었습니다. 읽기 어려운 값은 0으로 두고 안내가 뜹니다.
  **최종 확인은 사람이 합니다.**
