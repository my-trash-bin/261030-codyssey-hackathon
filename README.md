# SafeHandoff

사내 로그/표/운영 메모를 외부(오픈소스 메인테이너, B2B 기술지원 공급사, 외부 운영 자문사)에 공유할 때, **무엇을 어느 수준으로 공개할지 사람이 미리보기로 결정하면 승인된 사실(`FactPack`)만으로 새 공유 문서/표/합성 재현 예제를 작성하고 검토하는 로컬 설치형 도구**입니다.

원본 문서를 통째로 모델에 넣어 마스킹만 시키는 대신, **원자료 분석(`Analyst`) -> 사람의 공개 수준 결정(`A/B/C/D`) 및 결정적 변환(`builtin-tools`) -> 승인팩 전용 작성(`Writer`) -> 기본 거부 Grounding 및 검토(`Reviewer`) -> 무인터넷 Docker 합성 재현(`DockerReproRunner`)**의 입력/권한 경계를 분리합니다.

---

## 1. 한눈에 보는 정본 문서

| 문서 | 설명 |
| --- | --- |
| [intent.md](intent.md) | 사용자 확정 의도 원문 (`INT-01-INT-12`) |
| [docs/product/prd.md](docs/product/prd.md) | **현행 제품 요구사항 정본 (`PRD-01-PRD-14`)** - 해커톤 구현 범위 vs 전체 제품 목표 한 장 요약 |
| [docs/design/user-flow.md](docs/design/user-flow.md) | 핵심 흐름의 화면 목적·선택지 이유·미확정 제약과 UF별 검토 TODO |
| [docs/product/plan.md](docs/product/plan.md) | **해커톤 2일 수직 슬라이스(`H1-H4`)** vs 제품 마일스톤(`M0-M5`), **5인 실제 팀 역할 분담 및 커밋 구조** |
| [docs/qa/acceptance-map.csv](docs/qa/acceptance-map.csv) / [docs/qa/traceability.csv](docs/qa/traceability.csv) | 127개 수용 기준(`AC-F01-01-AC-F10-12`) 및 60개 QA 시험(`T01-T60`)과 자동화 테스트 파일 매핑 |
| [docs/design/architecture.md](docs/design/architecture.md) / [docs/design/api.md](docs/design/api.md) / [docs/design/erd.md](docs/design/erd.md) | TypeScript 9개 패키지 구조, HTTP/엔진 API 계약, SQLite 스키마 |
| [docs/product/decisions.md](docs/product/decisions.md) / [docs/design/spec.md](docs/design/spec.md) / [docs/design/security.md](docs/design/security.md) | 제품 핵심 가치·방향성의 의사결정, 상태/불변조건(`INV-01-16`), 실행 보안 경계 |
| [docs/design/agent-workflow.md](docs/design/agent-workflow.md) / [docs/design/extensions.md](docs/design/extensions.md) | 역할별 JSON 계약/`groundFacts`/`transcript.v1` 및 `SkillPack`/내장 변환/Docker 재현 계약 |
| [docs/design-tokens.md](docs/design-tokens.md) | 디자인 토큰 3단계(프리미티브/시멘틱/컴포넌트), 눈금, KRDS 참고 출처, `/#design-system` 화면 |
| [docs/design/ia.md](docs/design/ia.md) / [docs/ops/uj.md](docs/ops/uj.md) / [docs/ops/demo.md](docs/ops/demo.md) | 화면 구조(`UI-01-10`), 사용자 여정(`UJ-01-07`), 로컬/Docker 시연 절차 |
| [docs/features/01-task-intake.md](docs/features/01-task-intake.md) - [10-runtime-boundary.md](docs/features/10-runtime-boundary.md) | 기능 단위 명세 (`F01-F10`) |
| [docs/presentation/ISSUES.md](docs/presentation/ISSUES.md) / [GUIDE.md](docs/presentation/GUIDE.md) | 발표 슬라이드와 실제 코드 사이의 차이 관리(`PRES-01-12`) 및 발표 가이드 |
| [docs/product/submission-status.md](docs/product/submission-status.md) | **지금 제출한다고 가정했을 때 심사자에게 밝혀야 할 제한과 제출 직전 체크리스트** (수치는 검증 스크립트를 직접 재실행해 확인) |

---

## 2. TypeScript 워크스페이스 구조 (`packages/*`)

Node 24(`node:sqlite`, `node --test`) + TypeScript 5.8 + React 19 기반 `pnpm` 모노레포입니다.

| 패키지 | 역할 | 핵심 구현 |
| --- | --- | --- |
| `@safehandoff/core-interface` | 순수 도메인 인터페이스/검증/투영 (외부/Node 의존성 0) | `parseSources`, `composeFactPack`, `groundFacts`, `validatePackLayout`, `resolveToolAccess` |
| `@safehandoff/core` | 에이전트 오케스트레이션 및 내장 변환 도구 | `RealCore` (`analyze`, `write`, `review`, `writeReviewed`, `reproduce`, `generate`), `builtin-tools` 5종, `FileTranscriptSink` |
| `@safehandoff/model-adapter` | OpenAI 호환 LLM HTTP 클라이언트 | `OpenAICompatibleModelClient` (`/v1/chat/completions`, 타임아웃/크기 제한/엄격 오류 매핑) |
| `@safehandoff/sandbox-runner` | 무인터넷 Docker 재현 실행기 | `DockerReproRunner` (`--network=none`, `--read-only`, 이미지 digest 검증, 4회 실행 고정 oracle) |
| `@safehandoff/skill-loader` | 도메인 지침 팩(`SkillPack`) 로더 | `FsSkillPackLoader` (`O_NOFOLLOW` 심볼릭링크 차단, `manifest.json` 및 파일 전체 SHA-256 지문 검증) |
| `@safehandoff/server` | HTTP 서버 및 SQLite 저장소 | `createServer` (task API, `/health`, `/api/core`), `TaskStore` (`workflow_*` 11개 테이블/migration v2/`TaskStore.analysis` CAS) |
| `@safehandoff/app` | 실제 실행 서버 (`:8080`) | `RealCore` + `OpenAICompatibleModelClient` + `DockerReproRunner` + SQLite 연결 |
| `@safehandoff/fake-app` | 시연용 API 서버 (`:8081`) | 외부 모델을 호출하지 않는 `FakeCore` Engine + SQLite workflow + 시연 상태 제어 (`/__demo`, `/api/demo/settings`) |
| `@safehandoff/client` | 웹 클라이언트 (`:5173` / `:5174`, React 19 + Vite) | 업무용 콘솔 형태의 6단계 작업 화면. 세션, 카탈로그 기반 작업 등록, 원자료, 분석, 공개 결정, 초안/검토/확정, 규칙, 이력, 문서 보관소를 인증된 `/api/v1` 경로로 호출. 상태는 순수 reducer(`disclosure-state.ts`)와 훅(`ui/hooks/`)이 소유 |

---

## 3. 빠른 실행 및 검증

### 3.1 빌드 및 테스트

```sh
pnpm build
pnpm typecheck
pnpm test
python tools/validate_docs.py
```

현재 제공 범위에서 제거한 기능과 선택적 후속 계획은
[삭제 기능과 후속 검토](docs/product/deferred-features.md)를 확인합니다.

### 3.2 서버/클라이언트 실행

`mise install` 후 `just app`으로 API 서버와 웹 화면을 함께 실행합니다.
API만 실행하려면 `just api`, 웹만 실행하려면 `just web`을 사용합니다. 각 명령은
`pnpm install --frozen-lockfile`과 빌드를 자동 수행합니다.
준비 단계는 진행 상태만 표시하고 원시 로그는 `.local/bootstrap-log-*/output.log`에 저장합니다.
실패하면 해당 로그 경로를 안내합니다.
`just app`은 준비를 한 번만 수행하고 두 서버를 시작합니다. 웹 화면은 `http://127.0.0.1:5173/`이며
8080은 API 전용입니다. Ctrl+C 또는 한 서버의 종료 시 함께 실행한 다른 서버도 종료합니다.
API와 웹은 모두 `.env`의 `HOST`를 수신 주소로 사용합니다. 기본은 `127.0.0.1`이며,
다른 기기에서 접속하려면 `HOST=0.0.0.0`으로 설정하고 `http://<서버 IP>:5173/`로 접속합니다.
`.env`가 없으면 먼저 `.env.example`을 복사합니다. 기존 `.env`는 그대로 사용합니다.
`just app`은 `.env`와 환경 변수(환경 변수 우선), 선택한 config의 provider 변수명을 사용합니다.
없는 모델 URL·모델명·API 키는 프롬프트로 받으며 키는 숨김 입력입니다. 인증이 없으면 Enter로 생략합니다.
입력한 값은 루트 `.env`에 저장하고 실제 앱에도 전달합니다. 다음 실행부터 저장된 값을 재사용합니다.
API 키 없이 Enter로 진행한 경우 빈 값으로 저장하며 다시 묻지 않습니다. `.env`는 소유자만 읽고 쓰도록
저장하고, 기존의 다른 설정과 주석은 보존합니다. 비대화형 실행은 연결 정보를 미리 설정합니다.

config의 `reproduction.enabled=true`이고 `SAFEHANDOFF_REPRO_REGISTRY`가 없으면,
Go 실행기·Docker 이미지를 빌드하고 실제 digest 및 새 합성 입력을 등록한 파일을
`.local/app-runtime-*/repro-registration.json`에 생성하여 실제 앱에 자동 주입합니다.
등록 경로를 이미 지정했으면 해당 파일을 사용하고, reproduction이 disabled이면 준비를 생략합니다.
새 clone의 `config.example.json`은 reproduction이 disabled이므로 Docker가 필요 없습니다.
재현을 켜려면 별도 config에서 enabled를 true로 설정합니다.
Go는 mise에 포함되며 재현 활성화 시 Linux `/usr/bin/docker`, 실행 중인 로컬 데몬과 소켓 권한이 필요합니다.
기존 config·재현 등록 파일은 수정하지 않습니다. 상세는 [실행기 설치 안내](packages/sandbox-runner/image/README.md)를 참고합니다.
runner 주입을 준비하며 HTTP/UI 재현 실행은 아직 미구현입니다.

```sh
# 실제 앱 전체: API (:8080) + 웹 화면 (:5173)
just app

# 각각 실행할 때는 두 터미널에서 실행
just api
just web

# LLM 없이 시연 흐름을 확인하는 가짜 앱 (:8081) + 웹 클라이언트 (:5174)
just fake-app
just fake-client
```

### 3.3 UI용 task/공개 결정 HTTP

실제 앱은 시작 토큰이나 로그인 없이 접속합니다. `just app`이 출력한 일반 접속 URL을 열면
작업 공간이 자동으로 연결됩니다. 세션 쿠키와 CSRF/Host/Origin/revision/멱등 키 검사는
요청 무결성을 위해 내부에서 처리합니다. 세션 만료·서버 재시작 뒤에도 화면이 자동 재연결합니다.
작업 API는 기본 활성화이며 `SAFEHANDOFF_WORKFLOW_ENABLED=0`으로 끌 수 있습니다.
별도 사용자 인증은 제공하지 않습니다. fake-app도 같은 작업 API 계약을 사용하지만 고정 응답 `FakeCore`와 별도 시연 DB에만 연결됩니다.
상세 DTO는 [docs/design/api.md](docs/design/api.md) 5, 남은 UI 연결은 [docs/ops/ui-api-requests.md](docs/ops/ui-api-requests.md)를 따릅니다.

### 3.4 CDP 시연 및 OSS Docker 재현 스모크

새 clone에서 `mise install` 후 `just demo`를 실행하면
`pnpm install --frozen-lockfile`, 빌드, Chromium 설치 후 실제 `@safehandoff/client` 화면을
별도 포트의 `fake-app`에 연결해 엽니다. 별도 시연 UI clone은 사용하지 않으며, 실제 REST/UI 계약으로
작업 생성, 원자료 등록, 분석, 공개 결정, 초안/검토, 최종 확정까지 자동 진행합니다.
API 키나 Docker는 필요 없습니다. `just demo-check`는 이 전체 사용자 흐름을 headless Chromium으로 검증합니다.

```sh
mise install
just demo
just demo --headless --fast
```

Linux 브라우저 시스템 라이브러리 설치에는 sudo 권한이 필요할 수 있습니다.
설치한 브라우저는 `CHROME_PATH`로 지정할 수 있습니다. 녹화는 macOS Swift/AVFoundation이 필요합니다.
브라우저가 `No usable sandbox!`로 종료하는 환경에서는 호스트의 sandbox 설정을 확인합니다.
격리된 로컬 fixture 화면에 한해 sandbox 없이 실행하는 선택 옵션은 `just demo --no-sandbox`입니다.

실제 모델 연결 및 Docker runner 준비는 기존 `just app`에서 처리합니다(3.2 참고).
아래 OSS CLI는 별도 개발 검증 도구이며 이미지와 installation을 준비한 경우의 수동 명령입니다.

```sh
# 실제 client + fake core workflow의 전체 사용자 흐름 확인
mise exec -- just demo
mise exec -- just demo-check
mise exec -- just demo-record

# ToyRecord 스킬 팩 등록 및 Docker 4회 재현 + 작성/검토 스모크 실행
node tools/pack-register.mjs \
  --root fixtures/skills/toyrecord-repro \
  --allowlist fixtures/skills/toyrecord-allowlist.json \
  --catalog .local/toyrecord-catalog.json

node tools/oss-repro-smoke.mjs \
  --catalog .local/toyrecord-catalog.json \
  --pack-version 1.0.0 \
  --registration .local/toyrecord-installation.json \
  --seed 42 \
  --output .local/toyrecord-pack-smoke-42.json
```

자세한 현재 상태와 과거 영상 출처 메타데이터는 [시연 안내](docs/ops/demo.md)와
[과거 영상 안내](docs/presentation/video/README.md)에서 확인할 수 있습니다. 영상 파일 자체는 tracked 파일에서 제거했습니다.

### 3.5 모델 통신과 결과 인자 복구

모델 통신은 Vercel AI SDK의 OpenAI 호환 provider를 사용한다. SDK 자체 재시도는 비활성화하고
기존 Engine 호출 예산, 직접 전송의 리다이렉트 금지, 크기 제한과 타임아웃을 유지한다.

분석/작성/검토는 `@typia/vercel`의 로컬 `submit` 도구로 결과만 받습니다. 이 도구는 원자료 조회나
외부 실행 기능이 없으며 공개 권한을 만들지 않습니다. 런타임 JSON Schema와 typia 유틸리티를
사용하므로 별도 TypeScript 변환기 설치는 필요하지 않습니다. 기존 모델 환경 변수는 유지합니다.

SDK의 tool-call repair는 먼저 제한된 JSON 구문 복구와 타입 변환을 시도하고 기존 근거/참조
검증을 적용합니다. 추가 모델 호출은 `provider.max_attempts_per_step`과
`workflow.max_model_calls_per_run`을 모두 소비합니다. writer와 reviewer 사이에도 전체 예산을
공유하며 `max_review_repairs`가 제어하는 문서 수정 횟수와는 별개입니다. 도구 호출이 없거나
여러 개면 거부하며 텍스트 응답으로 대체하지 않습니다. 공개 조건 해석(disclosure)과
provider 확인은 기존 텍스트 경로를 유지합니다.

분석/작성/검토에는 tool calling을 지원하는 OpenAI 호환 모델 서버가 필요합니다.

### 3.6 작업 화면 구현 상태와 실행 방식

작업 화면과 fake-app 설정 화면은 React + TypeScript 함수 컴포넌트입니다. 시연의 제품 화면도
`packages/client`의 같은 `App`을 사용합니다. 상태 소유자는 클래스나
구독 어댑터 객체가 아니라 `packages/client/src`의 순수 reducer와, 그 reducer를 `useReducer`로 붙인
훅입니다. `disclosuresReducer`(`disclosure-state.ts`)와 작업 흐름 훅(`ui/hooks/useTaskFlow.ts`,
공유 타입과 상수는 `task-flow-model.ts`)이 화면 상태의 단일 원천이고, 파생 값과 명령 계획은
`disclosure-selectors.ts`가 현재 상태만으로 계산합니다. 파일 검증/직렬화/응답 계약 검사는 순수
함수(`analysis-state.ts`, `disclosure-format.ts`, `disclosure-contract.ts`)로 분리하며, `useRef`는
요청 세대 번호와 `AbortController`, 진행 중 점유 같은 요청 수명만 다룹니다. 세션 CSRF 토큰은
`App`의 React 상태로 공유합니다.

현재 작업 화면은 자동 세션과 CSRF를 사용하며, 작업 생성 -> 원자료 등록 -> 분석 -> 공개 결정 ->
초안 작성·검토 -> 확정·다운로드를 연결합니다. 목적을 선택하고 수신처를 직접 입력합니다.
프로젝트나 수신처를 미리 등록할 필요가 없습니다. 다음 입력 개편은
[목적과 자료 준비 설계](docs/features/01-task-intake.md)에만 반영했습니다. 설명 필수·제목/목적/공개 범위 선택·
수신처/목표 필드 제거는 현재 UI/API에 아직 적용되지 않았습니다. 분석은 `분석 시작` 버튼으로 실행하며 별도 동의 체크는 없습니다.
공개 결정 저장과 파일 확정·작업 삭제도 해당 버튼으로 실행합니다.
삭제·확정 API에는 별도 확인 문자열이나 확인 불리언을 보내지 않습니다. 작업 목록과 이벤트 이력도 제공합니다.

내부 메모 보관함, 구형 context 생성/독립 분석 API, 로그인·로그아웃 화면, 원시 JSON 편집,
별도 규칙 관리와 실행 환경 화면은 제거했습니다. 현재 제거 범위와 향후 추가 조건은
[기능 정리 및 추가 후보](docs/product/deferred-features.md)에 DF 번호로 관리합니다.
재사용 결정의 서버 검증과 철회에 따른 다운로드 무효화는 유지합니다.
자료 분석과 검토 화면의 원문·공개 내용 대조 기능은 유지합니다.
자료 분석 단계는 분석 모델 주소와 상태를 보여 주고 `POST /api/v1/model-check`로 연결을 확인합니다.
주소는 서버 환경 변수(`SAFEHANDOFF_LLM_BASE_URL`)로만 바꾸며, 설정이 비어 있으면 화면이 변수 이름을 안내합니다.

시각 기준은 [docs/UI-구현기준.md](docs/UI-구현기준.md)의 시각 기준 절을 따릅니다. 색, 글자, 간격,
버튼과 입력 크기는 [docs/design-tokens.md](docs/design-tokens.md)의 토큰으로만 정하며, 토큰과 컴포넌트
상태는 개발 서버에서 `/#design-system` 화면으로 확인합니다. 전체 높이 사이드바와 상단바, 흰 본문, 가로줄 표로 구성하고 강조색은 한 색만 쓰며, 서체는 시스템 산세리프 하나입니다. 외부 웹폰트를 쓰지 않아 기존 CSP와 외부 자산 미호출 경계를 유지합니다. 미연결 사유는
해당 동작 가까이에 짧게 표시하고, 개발용 예시 모드는 실제 실행과 구분해 표시합니다.

빌드된 작업 화면은 `vite build`가 만든 `packages/client/dist/static`을 Node가 서빙하고 API를
프록시하며 `just app` 또는 `just web`으로 실행합니다. 개발 실행(`pnpm dev:client`,
`just fake-app`)은 같은 Node 서버에 Vite 미들웨어를 붙이며 HMR과 WebSocket을 쓰지 않으므로 편집
뒤 브라우저를 새로고침합니다. 고정 Node 버전의 네이티브 설정 로더로 Vite 설정을 읽어
`node --watch`가 임시 설정 번들 때문에 반복 재시작하지 않게 합니다.

### 3.7 React 전환 시점의 검사 기록

아래 수치는 React 전환 작업을 마친 시점에 실행한 기록입니다. 원격 `main`을 병합한 트리에서 다시 실행한 결과가 아니므로 병합 뒤 전체 검사 결과로 인용하지 않습니다.

- `mise exec -- pnpm typecheck`로 전체 패키지 빌드와 타입 검사를 통과했습니다. 이어
  `mise exec -- pnpm -r test`와 `mise exec -- node --test tools/*.test.mjs`에서 합계 192개
  통과, 실패 0개, 건너뜀 21개를 확인했습니다. 클라이언트 73개와 fake-app 4개가 포함되며, 건너뜀은
  Linux 전용 파일 시스템 검사 19개와 실제 Docker 실행 검사 2개입니다. Node는 고정 버전 24.21.0입니다.
- 클라이언트 상태 회귀 검사는 jsdom 안의 실제 React root에 훅을 렌더링하고 `React act`로 전이를
  관찰합니다(`test-helpers/react-hook.ts`의 `renderHook`). 취소와 입력 변경 뒤 늦은 응답, 판본
  충돌, 미리보기 무효화, 적용과 철회를 검사하며, 클래스나 가짜 훅 실행기로 React를 대체하지 않습니다.
- 브라우저에서는 로컬 결정적 모델 응답과 실제 서버/코어 처리기를 조합해 세션, 작업 생성, CSV 등록,
  분석 채택, A 미리보기/적용/철회, D 비동기 해석의 단건 결과 조회/미리보기/적용, 내부 분석의 근거
  4개와 후보 1개 표시, 입력 변경 시 동의 해제와 이전 결과 보존, 내부 메모 저장을 확인했습니다.
  조건 입력의 중간 커서와 접이식 구역도 상태 변경 뒤 유지됐습니다. 실제 외부 모델이나 운영 인증
  환경을 검증한 것은 아닙니다.
- 긴 작업 ID와 해시, 저장된 결정을 넣은 공개 결정 화면에서 320px과 1280px 문서 폭이 각각
  320px과 1280px인 것을 확인했습니다. `.disclosures`의 단일 열을 `minmax(0, 1fr)`로 지정해 내용의
  최소 너비 때문에 생기는 가로 넘침을 막았습니다.
- 운영 빌드의 HTML, CSS, 해시 JS와 API 프록시를 브라우저에서 확인했고, 기존 CSP 아래에서 React가
  실행되며 구 `/main.js`와 루트 이탈 요청은 404입니다. fake-app의
  `mise exec -- pnpm demo:cdp --headless --fast --verify-playback`도 통과했습니다. 검사 전용
  응답기와 스크립트는 운영 코드에 포함하지 않습니다.
- 전환 시점에 `mise exec -- just check`는 `docs/valid-reference`에서 막혔습니다. 문서 전반의 API
  경로와 파일명 일부, 일반 슬래시 표현을 없는 파일로 판정하는 검사였으므로 전체 QG 통과로
  보고하지 않았습니다. 그 뒤 원격 `main`이 QG의 슬래시 참조 설정을 제거했으므로, 이 실패는 전환
  시점 기록이며 병합 트리의 현재 판정으로 쓰지 않습니다. 해당 시점에 검사 설정이나 무관한 문서는
  바꾸지 않았습니다.
