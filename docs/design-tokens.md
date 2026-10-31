# 디자인 토큰

작업 화면의 색, 글자, 간격, 반경, 버튼과 입력 크기는 `packages/client/public/tokens.css`에만 정의한다. 화면 CSS
(`style.css`, `flow.css`, `disclosure.css`, `design-system.css`)는 이 토큰을 참조하고 직접 값을 적지 않는다.
`packages/client/src/design/tokens.test.ts`가 이 규칙을 검사하므로, 값을 직접 적으면 테스트가 실패한다.

## 외부 참고 자료

토큰의 단계 구분, 이름 규칙, 눈금 구조는 대한민국 정부 디자인 시스템 KRDS의 안내를 참고했다. 색 팔레트와
서체는 이 제품의 문서 분위기(종이/잉크/인주)에 맞춘 자체 값이며 KRDS 색을 그대로 쓰지 않는다.

| 참고 자료 | 사용한 부분 | 확인일 |
| --- | --- | --- |
| [KRDS 디자인 토큰 안내](https://www.krds.go.kr/html/site/style/style_07.html) | primitive/semantic/component 세 단계 구분, 토큰 표기 규칙, 선명한 화면과 반응형 모드 개념 | 2026-11-01 |
| [KRDS 디자인 토큰 전체 보기](https://www.krds.go.kr/html/site/style/style_07_popup.html) | 토큰 목록 화면의 항목 구성(색/수치/반경/높이) | 2026-11-01 |
| [KRDS UIUX 저장소 `tokens/transformed_tokens.json`](https://github.com/KRDS-uiux/krds-uiux/blob/main/tokens/transformed_tokens.json) | `primitive.number`(2, 4, 8, 12, 16, 20, 24, 32, 40, 48px), `semantic.gap/padding/size-height/radius` 이름 체계, `mode-light` 색 역할 이름 | 2026-11-01 |

KRDS는 글자 크기를 10px 기준 rem(예: 1.9rem = 19px)으로 적는다. 이 저장소는 브라우저 기본 16px 기준 rem을 쓰므로
값을 그대로 복사하지 않고 같은 눈금 이름과 단계만 가져왔다.

## 세 단계

| 단계 | 접두 | 쓰임 | 예 |
| --- | --- | --- | --- |
| 프리미티브 | `--p-*`, `--num-*`, `--font-size-*`, `--line-height-*`, `--font-weight-*` | 값의 원본. 화면 CSS에서 직접 쓰지 않는다 | `--p-sand-90`, `--num-8`, `--font-size-14` |
| 시멘틱 | `--color-*`, `--space-*`, `--type-*`, `--layout-*`, `--radius-*`, `--border-width*` | 역할 이름. 화면 CSS는 대부분 이 단계를 쓴다 | `--color-text-muted`, `--space-5`, `--type-body-sm-size` |
| 컴포넌트 | `--button-*`, `--input-*`, `--panel-*`, `--rail-*`, `--progress-*`, `--table-*`, `--chip-*` | 버튼, 입력, 카드, 단계 목록, 표, 칩의 크기와 여백 | `--button-height`, `--input-padding-x`, `--panel-padding-y` |

시멘틱 단계는 프리미티브를 참조하고, 컴포넌트 단계는 시멘틱을 참조한다. 아래 단계를 건너뛰고 프리미티브를
화면에 직접 쓰지 않는다.

## 색

| 역할 | 토큰 | 값 |
| --- | --- | --- |
| 바탕 | `--color-surface-page` | 종이 10 (`#f6f2e9`) |
| 카드 | `--color-surface-raised` | 종이 0 (`#fffcf4`) |
| 본문 | `--color-text-primary` | 잉크 90 (`#1a1917`) |
| 보조 글자 | `--color-text-secondary` | 종이 80 (`#423e36`) |
| 힌트 | `--color-text-muted` | 종이 70 (`#655f53`) |
| 헤어라인 | `--color-border-subtle` | 종이 40 (`#d9d1c0`) |
| 구조 경계 | `--color-border-strong` | 종이 60 (`#8f8472`) |
| 강조 | `--color-text-accent` / `--color-surface-accent` / `--color-border-accent` | 인주 50 (`#9c2b21`) |
| 성공, 주의, 위험 | `--color-text-success` / `--color-text-warning` / `--color-text-danger` | 초록 50, 황토 50, 인주 50 |

- 강조색은 결정과 선택 표시에만 쓴다. 두 번째 강조색을 만들지 않는다.
- 상태를 색만으로 구분하지 않는다. 칩과 상태 문구는 항상 글자를 함께 쓴다.
- 계산된 대비(종이 바탕): 본문 15.7:1, 보조 글자 9.5:1, 힌트 5.7:1, 인주 6.8:1, 구조 경계 3.3:1. 글자에는 4.5:1 이상인 값만 쓴다.

## 눈금

| 종류 | 값 |
| --- | --- |
| 간격 | `--space-1` 2px, `2` 4px, `3` 8px, `4` 12px, `5` 16px, `6` 20px, `7` 24px, `8` 32px, `9` 40px, `10` 48px, `11` 64px, `12` 80px |
| 글자 | `--font-size-12/14/16/20/24/40` 여섯 값만 쓴다 |
| 줄 높이 | `--line-height-tight` 1.2, `snug` 1.35, `normal` 1.55, `relaxed` 1.65 |
| 굵기 | `regular` 400, `medium` 500, `bold` 600, `strong` 700 |
| 반경 | `--radius-none` 0 (기본), `--radius-full` 999px (원형 표시만) |
| 테두리 | `--border-width` 1px, `--border-width-strong` 2px, `--border-width-focus` 3px |

여백과 패딩, 간격은 간격 눈금에서만 고른다. `13px`, `18px`처럼 눈금 밖 값은 쓰지 않는다. 미디어 쿼리
폭은 CSS 변수를 쓸 수 없어 숫자로 남기되, 토큰의 `--breakpoint-*` 값과 같게 유지한다
(`900px` = `56.25rem`, `1280px` = `80rem`, `760px` = `47.5rem`).

## 컴포넌트 토큰

| 컴포넌트 | 토큰 |
| --- | --- |
| 버튼 | `--button-height` 40px, `--button-height-list` 36px, `--button-height-small` 32px, `--button-padding-x/y`, `--button-font-size` |
| 입력 | `--input-height` 40px, `--input-padding-x/y`, `--input-border`, `--input-border-invalid`, `--input-font-size` 16px |
| 셀렉트 목록 | `--select-picker-padding`, `--select-option-padding-x/y`, `--layout-picker-max` |
| 체크박스, 라디오 | `--control-mark-size` 20px, `--control-mark-check-size` 10px, `--control-mark-dot-size` 8px, `--control-mark-background`, `--control-mark-background-checked` |
| 카드와 패널 | `--panel-padding-x` 32px, `--panel-padding-y` 24px, `--panel-gap` 16px |
| 단계 목록 | `--rail-width`, `--rail-item-padding-y`, `--rail-marker-width` |
| 진행 막대 | `--progress-track` 3px, `--progress-gap` 4px |
| 표 | `--table-cell-padding-x/y`, `--table-border` |
| 칩 | `--chip-padding-x/y`, `--chip-border`, `--chip-text` |

## 컨트롤 높이와 커스텀

네이티브 컨트롤은 그대로 두고 모양만 토큰으로 바꾼다. 키보드 동작과 라벨 연결, 폼 제출 동작을 잃지 않기 위해서다.

| 컨트롤 | 높이 | 방법 |
| --- | --- | --- |
| 한 줄 입력, 셀렉트 | 40px (`--input-height`) | `height` 고정, 안쪽 여백은 가로만 준다 |
| 여러 줄 입력 | 최소 80px (`--space-12`), 자동 확장 | 세로 여백을 주고 `resize: vertical` |
| 버튼 | 40 / 36 / 32px | `--button-height*` |
| 셀렉트 목록 | `::picker(select)` | `appearance: base-select`를 지원하는 브라우저에서 종이색 목록과 헤어라인, 선택 표시를 그린다. 지원하지 않으면 브라우저 기본 목록을 쓴다 |
| 체크박스, 라디오 | 20px | `appearance: none` + `::after`로 선택 표시를 그린다. 선택 시 인주색 바탕에 종이색 표시 |
| 파일 선택 | 40px | `FileField` 컴포넌트가 입력과 같은 상자 안에 작은 버튼과 고른 파일 이름을 보여 준다. 실제 파일 입력은 라벨 안에 숨겨 키보드와 스크린 리더 동작을 지킨다 |

여백 규칙은 하나다. 라벨과 컨트롤 사이는 8px(`--field-gap`), 필드와 필드 사이는 16px(`--form-gap`)이며, 이 값은 화면
어디서나 같다. `.field`는 `align-content: start`로 위쪽에 붙여 두어, 도움말 줄 수가 달라도 같은 줄의 컨트롤 윗선이
어긋나지 않는다. 필드를 나란히 놓을 때는 두 열을 넘기지 않고, 좁은 폭에서는 한 열로 떨어진다.

파일 선택은 `packages/client/src/ui/FileField.tsx`를 쓴다. 화면에서 파일 입력을 직접 그리지 않는다.

범례(`legend`)는 카드 위 테두리에 걸쳐 그려지므로 좌우 8px 여백을 두어 테두리 선과 글자가 붙지 않게 한다.
카드 안쪽은 12px/16px 여백을 쓰고, 후보 ID처럼 붙여 읽는 안내 줄은 4px로 묶는다.

본문은 `word-break: keep-all`과 `overflow-wrap: anywhere`를 함께 쓴다. 한글은 어절 단위로 끊고, 해시나 파일 이름처럼
긴 토큰만 넘칠 때 아무 데서나 끊는다.

## 디자인 시스템 화면

토큰과 컴포넌트 상태는 앱과 같은 번들의 해시 경로에서 볼 수 있다.

```sh
mise exec -- pnpm --filter @safehandoff/client dev
# 브라우저에서 http://127.0.0.1:5174/#design-system
```

- 화면 구성: 색(프리미티브, 시멘틱 표면/글자/경계), 글자 단계, 간격과 반경, 버튼 상태, 입력 상태, 상태 표시,
  카드와 표, 머리말과 단계 목록, 단계 화면, 후보 카드, 접이식 영역, 빈 상태, 상자와 행동 줄, 정보 열.
- 화면 조각은 작업 화면과 같은 클래스(`.masthead`, `.rail`, `.step`, `.candidate`, `.fold`, `.panel`, `.draft__sheet`,
  `.inspector__block`)를 그대로 쓴다. 모양이 앱과 갈라지지 않도록 새 클래스를 만들지 않는다.
- 값은 `getComputedStyle`로 읽으므로 토큰을 고치면 화면도 바로 바뀐다. 화면에 적힌 hex와 px는 실제 계산값이다.
- 해시 경로를 쓴 이유는 정적 서버 설정을 바꾸지 않기 위해서다. 배포 정적 파일에도 같은 경로로 열린다.

## 토큰을 고칠 때

1. 값을 바꾸려면 `tokens.css`의 해당 단계만 고친다. 화면 CSS를 고치지 않는다.
2. 새 역할이 필요하면 시멘틱 단계에 추가하고, 프리미티브를 참조한다. 색 hex를 새로 만들지 않는다.
3. 새 컴포넌트 토큰은 기존 시멘틱을 참조한다. 예: `--button-height: var(--num-14)`.
4. `mise exec -- node --test packages/client/src/design/tokens.test.ts`로 정의 누락, 토큰 밖 색 값, 눈금 밖
   간격과 글자 크기를 확인한다.
