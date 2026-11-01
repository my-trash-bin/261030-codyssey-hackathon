# 디자인 토큰

작업 화면의 색, 글자, 간격, 반경, 버튼과 입력 크기는 `packages/client/public/tokens.css`에만 정의한다. 화면 CSS
(`style.css`, `flow.css`, `app-shell.css`, `disclosure.css`, `design-system.css`)는 이 토큰을 참조하고 직접 값을 적지 않는다.
`packages/client/src/design/tokens.test.ts`가 이 규칙을 검사하므로, 값을 직접 적으면 테스트가 실패한다.

## 외부 참고 자료

토큰의 단계 구분, 이름 규칙, 눈금 구조는 대한민국 정부 디자인 시스템 KRDS의 안내를 참고했다. 색 팔레트와
서체는 업무용 콘솔 분위기(중립 회색, 흰 표면, 파란 강조)에 맞춘 자체 값이며 KRDS 색을 그대로 쓰지 않는다.

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
| 바탕 | `--color-surface-page` | 중립 0 (`#ffffff`) |
| 카드, 사이드바, 패널 | `--color-surface-raised` | 중립 0 (`#ffffff`) |
| 본문 | `--color-text-primary` | 잉크 90 (`#1a1917`) |
| 보조 글자 | `--color-text-secondary` | 중립 80 (`#414d68`) |
| 힌트 | `--color-text-muted` | 중립 70 (`#5f6b85`) |
| 헤어라인 | `--color-border-subtle` | 중립 40 (`#e4e8f0`) |
| 구조 경계 | `--color-border-strong` | 중립 60 (`#8690a6`) |
| 강조 | `--color-text-accent` / `--color-surface-accent` / `--color-border-accent` | 강조 50 (`#3a5bd9`) |
| 성공, 주의, 위험 | `--color-text-success` / `--color-text-warning` / `--color-text-danger` | 초록 50 (`#0f7a4d`), 황토 50 (`#8a5a00`), 빨강 50 (`#b42318`) |

- 강조색은 결정과 선택 표시에만 쓴다. 두 번째 강조색을 만들지 않는다.
- 상태를 색만으로 구분하지 않는다. 칩과 상태 문구는 항상 글자를 함께 쓴다.
- 계산된 대비(흰 바탕): 본문 14.3:1, 보조 글자 8.4:1, 힌트 5.3:1, 강조 5.7:1, 구조 경계 3.2:1. 옅은 강조 면의 강조 글자 5.0:1, 옅은 초록 면의 성공 글자 4.7:1, 비활성 버튼 글자 4.6:1.

## 눈금

| 종류 | 값 |
| --- | --- |
| 간격 | `--space-1` 2px, `2` 4px, `3` 8px, `4` 12px, `5` 16px, `6` 20px, `7` 24px, `8` 32px, `9` 40px, `10` 48px, `11` 64px, `12` 80px |
| 글자 | `--font-size-12/13/14/16/20/24/40` 일곱 값만 쓴다. 지금 쓰는 단위는 라벨 12, 보조 13, 본문 14, 구역 제목 16, 단계 제목 20이다 |
| 줄 높이 | `--line-height-tight` 1.2, `snug` 1.35, `normal` 1.5, `relaxed` 1.5 |
| 굵기 | `regular` 400, `medium` 500, `bold` 600, `strong` 700 |
| 반경 | `--radius-none` 0, `--radius-sm` 4px (입력, 버튼, 칩, 카드), `--radius-md` 6px (패널), `--radius-full` 999px (원형 표시) |
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
| 한 줄 입력, 셀렉트 | 36px (`--input-height`) | `height` 고정, 안쪽 여백은 가로만 준다. 640px 이하에서는 모바일 확대를 막으려 글자만 16px로 키운다 |
| 여러 줄 입력 | 최소 80px (`--space-12`), 자동 확장 | 세로 여백을 주고 `resize: vertical` |
| 버튼 | 36 / 32 / 28px | `--button-height*` |
| 셀렉트 목록 | `::picker(select)` | `appearance: base-select`를 지원하는 브라우저에서 토큰 색 목록과 헤어라인, 선택 표시를 그린다. 지원하지 않으면 브라우저 기본 목록을 쓴다 |
| 체크박스, 라디오 | 16px | `appearance: none` + `::after`로 선택 표시를 그린다. 선택 시 강조색을 쓴다 |
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

## 참고 사례 대조

컴포넌트 모양과 동작을 공개 디자인 시스템과 비교해 확인한 결과다(확인일 2026-11-01).

| 컴포넌트 | 참고 사례 | 우리 구현 | 판단 |
| --- | --- | --- | --- |
| 필드 라벨과 도움말 | GOV.UK text input(label + hint) | 라벨 4px, 도움말 4px, 필드 사이 16px | 유지 |
| 그룹 캡션 | GOV.UK fieldset(테두리 없는 fieldset + legend) | 카드 `div` 안에 테두리 없는 `fieldset` + `legend` | 수정 완료 |
| 라디오와 체크박스 | GOV.UK radios(라디오를 라벨 왼쪽에, 사전 선택 금지) | 라디오 왼쪽, 20px, 사전 선택은 데모에만 | 유지 |
| 접이식 | WAI-ARIA APG disclosure(button + `aria-expanded`) | 네이티브 `details`/`summary`가 같은 역할과 키보드 동작을 제공 | 유지 |
| 파일 입력 | GOV.UK file upload(라벨을 버튼처럼) | 라벨 안에 실제 input을 숨긴 `FileField` | 유지 |
| 셀렉트 | 브라우저 기본 select | Chrome `appearance: base-select`, 그 외 네이티브 폴백 | 유지(한계 명시) |
| 단계 목록 | GOV.UK task list(링크 + 상태 문장) | 단계 이동 버튼 + `aria-current` | 유지 |
| 강제 색상 모드 | 접근성 요구 | 직접 그린 컨트롤 대신 `appearance: auto` 폴백 | 추가 |

출처:
- GOV.UK Design System fieldset <https://design-system.service.gov.uk/components/fieldset/>
- GOV.UK Design System radios <https://design-system.service.gov.uk/components/radios/>
- WAI-ARIA APG disclosure <https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/>
- MDN `<legend>` (예제에서 범례에 padding을 준다) <https://developer.mozilla.org/ko/docs/Web/HTML/Reference/Elements/legend>

## 외부 UI 라이브러리 검토

shadcn/ui는 기존 Vite 프로젝트에 넣을 때 Tailwind CSS(`@import "tailwindcss"`), `@/*` 경로 별칭,
`components.json`이 필요하고 컴포넌트는 Tailwind 클래스로 생성된다(확인일 2026-11-01,
<https://ui.shadcn.com/docs/installation/vite>). 이 앱은 UI 의존성 없이 `react`만 쓰고 토큰 CSS 3장으로
화면을 그리므로, 도입하면 Preflight 초기화, 토큰 팔레트를 Tailwind 쪽으로 다시 옮겨야 한다.

스타일을 강제하지 않는 대체 라이브러리를 npm 레지스트리 기준으로 비교했다(확인일 2026-11-01).

| 후보 | 스타일 | 라이선스 | 패키지 의존 | React | 메모 |
| --- | --- | --- | --- | --- | --- |
| Base UI `@base-ui/react` 1.9.0 | 없음(className) | MIT | 5 | 17 이상 | Radix, MUI, Floating UI 만든 팀. WAI-ARIA 패턴 |
| React Aria `react-aria-components` 1.22.1 | 없음(className) | Apache-2.0 | 8 | 19 포함 | Adobe. 동작 훅 중심, 접근성 기준이 가장 촘촘 |
| Ariakit `@ariakit/react` 0.4.42 | 없음 | MIT | 1 | 17~19 | 네이티브 요소 우선, 의존 최소 |
| Headless UI 2.2.10 | 없음 | MIT | 5 | 18, 19 | Dialog, Combobox, Menu 등 좁은 세트 |
| Ark UI `@ark-ui/react` 5.40.0 | 없음 | MIT | 69 | 18 이상 | 상태 머신 기반, 의존이 많다 |
| Radix `radix-ui` 1.8.1 | 없음 | MIT | 55 | 19 포함 | 검증된 조합이지만 메타 패키지 의존이 많다 |
| shadcn/ui | Tailwind 클래스 | MIT | 프로젝트에 복사 | 19 | Base UI, Radix, React Aria 세 기반 중 선택. Tailwind 전제 |
| KRDS-React `krds-react` 1.1.1 | Tailwind | ISC | 0 | 18.2 이상 | Typography와 Tailwind 플러그인만 있어 컴포넌트 세트가 아니다 |
| dak-krds 1.0.15 | MUI 6, Emotion | MIT | 14 | 19 | KRDS 55종을 제공하지만 MUI 테마로 갈아타야 한다 |

지금 필요한 위젯(입력, 라디오, 체크박스, 셀렉트, 접이식)은 네이티브 요소로 같은 동작과 키보드 조작을 이미 얻는다.
셀렉트는 `appearance: base-select`가 Chrome에만 있어 다른 브라우저에서는 네이티브로 보인다. 이 차이를 없애야 하거나
모달, 콤보박스, 토스트가 생기면 Base UI나 React Aria에서 그 조각만 가져오는 쪽이 비용이 가장 낮다.

## 토큰을 고칠 때

1. 값을 바꾸려면 `tokens.css`의 해당 단계만 고친다. 화면 CSS를 고치지 않는다.
2. 새 역할이 필요하면 시멘틱 단계에 추가하고, 프리미티브를 참조한다. 색 hex를 새로 만들지 않는다.
3. 새 컴포넌트 토큰은 기존 시멘틱을 참조한다. 예: `--button-height: var(--num-14)`.
4. `mise exec -- node --test packages/client/src/design/tokens.test.ts`로 정의 누락, 토큰 밖 색 값, 눈금 밖
   간격과 글자 크기를 확인한다.
