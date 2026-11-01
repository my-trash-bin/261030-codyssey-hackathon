# SafeHandoff

사내 로그/표/운영 메모를 외부(오픈소스 메인테이너, B2B 기술지원 공급사, 외부 운영 자문사)에 공유할 때, **무엇을 어느 수준으로 공개할지 사람이 미리보기로 결정하면 승인된 사실(`FactPack`)만으로 새 공유 문서/표/합성 재현 예제를 작성하고 검토하는 로컬 설치형 도구**입니다.

원본 문서를 통째로 모델에 넣어 마스킹만 시키는 대신, **원자료 분석(`Analyst`) -> 사람의 공개 수준 결정(`A/B/C/D`) 및 결정적 변환(`builtin-tools`) -> 승인팩 전용 작성(`Writer`) -> 기본 거부 Grounding 및 검토(`Reviewer`) -> 무인터넷 Docker 합성 재현(`DockerReproRunner`)**의 입력/권한 경계를 분리합니다.

---

## 1. 한눈에 보는 정본 문서

| 문서 | 설명 |
| --- | --- |
| [intent.md](intent.md) | 사용자 확정 의도 원문 (`INT-01-INT-12`) |
| [docs/product/prd.md](docs/product/prd.md) | **현행 제품 요구사항 정본 (`PRD-01-PRD-14`)** - 해커톤 구현 범위 vs 전체 제품 목표 한 장 요약 |
| [docs/product/plan.md](docs/product/plan.md) | **해커톤 2일 수직 슬라이스(`H1-H4`)** vs 제품 마일스톤(`M0-M5`), **5인 실제 팀 역할 분담 및 커밋 구조** |
| [docs/qa/acceptance-map.csv](docs/qa/acceptance-map.csv) / [docs/qa/traceability.csv](docs/qa/traceability.csv) | 127개 수용 기준(`AC-F01-01-AC-F10-12`) 및 60개 QA 시험(`T01-T60`)과 자동화 테스트 파일 매핑 |
| [docs/design/architecture.md](docs/design/architecture.md) / [docs/design/api.md](docs/design/api.md) / [docs/design/erd.md](docs/design/erd.md) | TypeScript 9개 패키지 구조, HTTP/엔진 API 계약, SQLite 스키마 |
| [docs/product/decisions.md](docs/product/decisions.md) / [docs/design/spec.md](docs/design/spec.md) / [docs/design/security.md](docs/design/security.md) | 설계 결정(`D01-D24`, Go -> TypeScript 전환 경위 포함), 상태/불변조건(`INV-01-16`), 실행 보안 경계 |
| [docs/design/agent-workflow.md](docs/design/agent-workflow.md) / [docs/design/extensions.md](docs/design/extensions.md) | 역할별 JSON 계약/`groundFacts`/`transcript.v1` 및 `SkillPack`/내장 변환/Docker 재현 계약 |
| [docs/design-tokens.md](docs/design-tokens.md) | 디자인 토큰 3단계(프리미티브/시멘틱/컴포넌트), 눈금, KRDS 참고 출처, `/#design-system` 화면 |
| [docs/design/ia.md](docs/design/ia.md) / [docs/ops/uj.md](docs/ops/uj.md) / [docs/ops/demo.md](docs/ops/demo.md) | 화면 구조(`UI-01-10`), 사용자 여정(`UJ-01-07`), 로컬/Docker 시연 절차 |
| [docs/features/01-task-intake.md](docs/features/01-task-intake.md) - [10-runtime-boundary.md](docs/features/10-runtime-boundary.md) | 기능 단위 명세 (`F01-F10`) |
| [docs/presentation/ISSUES.md](docs/presentation/ISSUES.md) / [GUIDE.md](docs/presentation/GUIDE.md) | 발표 슬라이드와 실제 코드 사이의 차이 관리(`PRES-01-12`) 및 발표 가이드 |
| [docs/product/submission-status.md](docs/product/submission-status.md) | **지금 제출한다고 가정한 현재 상태 스냅샷** - 자동 검증 재실행 결과, AC 현황, 밝혀야 할 제한 |

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
| `@safehandoff/server` | HTTP 서버 및 SQLite 저장소 | `createServer` (`/api/documents`, `/api/sharing`, `/api/analysis`), `TaskStore` (`workflow_*` 11개 테이블/migration v2/`TaskStore.analysis` CAS) |
| `@safehandoff/app` | 실제 실행 서버 (`:8080`) | `RealCore` + `OpenAICompatibleModelClient` + `DockerReproRunner` + SQLite 연결 |
| `@safehandoff/fake-app` | 시연/연출용 서버 (`:8081`) | `FakeCore` + 시연 상태 제어 (`/__demo`, `/api/demo/settings`) 및 CDP 연출 화면 (`/__presentation`) |
| `@safehandoff/client` | 웹 클라이언트 (`:5173` / `:5174`, React 19 + Vite) | Swiss Grid 작업 화면. 세션, 카탈로그 기반 작업 등록, 원자료, 분석, 공개 결정, 초안/검토/확정, 규칙, 이력, 문서 보관소를 인증된 `/api/v1` 경로로 호출. 상태는 순수 reducer(`disclosure-state.ts`)와 훅(`ui/hooks/`)이 소유 |

---

## 3. 빠른 실행 및 검증

### 3.1 빌드 및 테스트

```sh
pnpm build
pnpm typecheck
pnpm test
python tools/validate_docs.py
```

### 3.2 서버/클라이언트 실행

`mise install` 후 기존 `just app`과 `just client`를 실행합니다. 두 명령 모두
`pnpm install --frozen-lockfile`과 빌드를 자동 수행합니다.
`just app`은 `.env`와 환경 변수(환경 변수 우선), 선택한 config의 provider 변수명을 사용합니다.
없는 모델 URL·모델명·API 키는 프롬프트로 받으며 키는 숨김 입력입니다. 인증이 없으면 Enter로 생략합니다.
입력은 이번 실제 앱 프로세스에 전달하고 파일에 저장하지 않습니다. 비대화형 실행은 연결 정보를 미리 설정합니다.

config의 `reproduction.enabled=true`이고 `SAFEHANDOFF_REPRO_REGISTRY`가 없으면,
Go 실행기·Docker 이미지를 빌드하고 실제 digest 및 새 합성 입력을 등록한 파일을
`.local/app-runtime-*/repro-registration.json`에 생성하여 실제 앱에 자동 주입합니다.
등록 경로를 이미 지정했으면 해당 파일을 사용하고, reproduction이 disabled이면 준비를 생략합니다.
새 clone의 `config.example.json`은 reproduction이 disabled이므로 Docker가 필요 없습니다.
재현을 켜려면 별도 config에서 enabled를 true로 설정합니다.
Go는 mise에 포함되며 재현 활성화 시 Linux `/usr/bin/docker`, 실행 중인 로컬 데몬과 소켓 권한이 필요합니다.
기존 `.env`·config·등록 파일은 수정하지 않습니다. 상세는 [실행기 설치 안내](packages/sandbox-runner/image/README.md)를 참고합니다.
runner 주입을 준비하며 HTTP/UI 재현 실행은 아직 미구현입니다.

```sh
# 실제 앱 (:8080) + 웹 클라이언트 (:5173)
just app
just client

# LLM 없이 시연 흐름을 확인하는 가짜 앱 (:8081) + 웹 클라이언트 (:5174)
just fake-app
just fake-client
```

### 3.3 UI용 task/공개 결정 HTTP

SAFEHANDOFF_WORKFLOW_TOKEN(32자 이상)을 설정하면 실제 앱에서 세션/CSRF/Host/Origin/revision/멱등 키를
검사하는 인증된 v1 task API(task 생성/원자료 교체/분석 job/CAS/수동 후보/미리보기/결정 배치/철회)를
사용할 수 있습니다. HTTP loopback/단일 운영자 개발용이며 미설정/fake-app은 WORKFLOW_API_DISABLED입니다.
상세 DTO는 [docs/design/api.md](docs/design/api.md) 5, 남은 UI 연결은 [docs/ops/ui-api-requests.md](docs/ops/ui-api-requests.md)를 따릅니다.

### 3.4 CDP 시연 및 OSS Docker 재현 스모크

새 clone에서 `mise install` 후 `just demo`를 실행하면
`pnpm install --frozen-lockfile`, 빌드, Chromium 설치, 기존 fake-app 화면 시연을 자동 수행합니다.
API 키나 Docker는 필요 없습니다. `just demo-check`와 `just demo-record`도 같은 준비를 수행합니다.

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
# 최신 fake-app 기반 CDP 6단계 연출 시연 및 탐색/녹화 검증
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

자세한 시연 시나리오/제출 영상(`docs/demo-media/SafeHandoff-demo.mp4`)/과거 영상 참고자료([docs/presentation/video/README.md](docs/presentation/video/README.md))는 [docs/ops/demo.md](docs/ops/demo.md)에서 확인할 수 있습니다.

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

작업 화면과 fake-app 연출 화면은 React + TypeScript 함수 컴포넌트입니다. 상태 소유자는 클래스나
구독 어댑터 객체가 아니라 `packages/client/src`의 순수 reducer와, 그 reducer를 `useReducer`로 붙인
훅입니다. `disclosuresReducer`(`disclosure-state.ts`)와 작업 흐름 훅(`ui/hooks/useTaskFlow.ts`,
공유 타입과 상수는 `task-flow-model.ts`)이 화면 상태의 단일 원천이고, 파생 값과 명령 계획은
`disclosure-selectors.ts`가 현재 상태만으로 계산합니다. 파일 검증/직렬화/응답 계약 검사는 순수
함수(`analysis-state.ts`, `disclosure-format.ts`, `disclosure-contract.ts`)로 분리하며, `useRef`는
요청 세대 번호와 `AbortController`, 진행 중 점유 같은 요청 수명만 다룹니다. 세션 CSRF 토큰은
`App`의 React 상태로 공유합니다.

서버 배선은 다음 범위까지 코드로 연결돼 있습니다.

- `useSession`이 `restoreSession`/`openSession`/`logoutSession`으로 `GET`/`POST`/`DELETE
  /api/v1/session`을 호출하고, 받은 토큰을 `App`이 `useDisclosures({ csrfToken })`/
  `useTaskFlow({ csrfToken })`로 내려 쓰기 헤더에 실립니다(`session-client.ts`).
- `useTaskFlow`가 `readCatalog` -> `createTask({ intake })` -> `startAnalysis` ->
  `readAnalysisJob` 순서로 작업 생성/원자료 등록/분석 job을 진행하고, 수동 후보 추가, 원자료 해제,
  분석 취소를 같은 훅에서 호출합니다(`task-client.ts`).
- `useDisclosures`가 `GET /api/v1/tasks/{id}` 조회와 C 필드 목록, 미리보기/조건 해석/결정 배치/
  철회를 호출합니다. C는 서버가 준 필드 목록에서만 고를 수 있고 선택 값은 브라우저에서 다시
  계산하지 않습니다.
- `useArtifacts`가 공유 초안 생성(`compose`)과 자동 검토, DocAST 편집 저장, 사람 의미 검토 기록,
  최종 확정, ZIP/개별 파일 다운로드를 호출합니다(`artifacts-client.ts`). 다운로드는 서버가 준 bytes를
  그대로 저장하며 다시 렌더링하지 않습니다.
- `useRules`/`useTaskBrowser`/`useTaskHistory`가 규칙 저장/목록/새 판본/철회/명시 적용, 작업 목록/
  삭제, 작업 이벤트 조회를 호출합니다(`rules-client.ts`, `task-browser-client.ts`,
  `workflow-client.ts`).
- 공개 결정 영역은 후보별로 미선택/허용/제외/보류를 따로 관리하고, 실제 미리보기 확인과 전체 일괄
  적용을 분리합니다. 배치가 409를 받으면 reducer가 재조회 요청을 만들고 훅의 효과가 그것을 한 번만
  소비합니다.
- 토큰이 없으면 쓰기는 사유만 표시하고 전송하지 않습니다(`disclosure-selectors.ts`의
  `writeBlockReason`). fake-app은 이 task API를 제공하지 않으며 별도 연출 화면을 사용합니다.
- 기존 `GET /api/core`, `GET/POST /api/documents`, `POST /api/analysis`도 유지합니다. 내부 파일
  분석은 목적/수신처/파일 확인과 승인된 사내/로컬 분석 환경 동의 뒤에만 호출하고, 파일 선택만으로
  전송하지 않으며 입력이 바뀌면 동의를 해제합니다. `crypto.subtle`을 쓸 수 없는 보안 문맥에서는
  요청 전에 오류를 안내합니다. 이 경로의 근거/후보 제안은 내부 검토용이며 task 후보나 공개 허가로
  자동 저장하지 않습니다. 내부 메모 저장/조회도 공개 승인/공유 초안과 별개입니다.
- `/api/v1/runtime`과 `/api/sharing`은 화면이 호출하지 않습니다. 실행 환경 패널은 `/api/core`의 세
  값과 세션 응답의 `analysis_environment`만 표시합니다.

이 배선은 합성 모델 client와 메모리 저장소로 띄운 서버에 실제 브라우저를 붙여 세션 열기/복원/
로그아웃, 카탈로그 작업 생성, 원자료 등록/해제, 분석 실행/취소, C 필드 선택과 미리보기, 결정 배치,
철회, 수동 후보 추가, 규칙 저장/새 판본/명시 적용/철회, 초안 작성/자동 검토, 사람 의미 검토,
확정, ZIP/개별 파일 다운로드(내려받은 파일 해시가 화면 표시값과 일치), 작업 삭제까지 한 번씩
실행해 확인했습니다. 세부 결과와 남은 간격은 [docs/UI-구현기준.md](docs/UI-구현기준.md)의 실행 확인
절에 적습니다. 실제 모델로 같은 흐름을 돌린 기록은 아니며, 그 구분을 유지합니다.

시각 기준은 [docs/UI-구현기준.md](docs/UI-구현기준.md)의 시각 기준 절을 따릅니다. 색, 글자, 간격,
버튼과 입력 크기는 [docs/design-tokens.md](docs/design-tokens.md)의 토큰으로만 정하며, 토큰과 컴포넌트
상태는 개발 서버에서 `/#design-system` 화면으로 확인합니다. 종이색 바탕과 직각, 무그림자에 12열
그리드를 쓰고 강조색은 한 색만 쓰며, 제목만 명조 계열이고 나머지는 시스템 글꼴입니다. 외부 웹폰트를 쓰지 않아 기존 CSP와 외부 자산 미호출 경계를 유지합니다. 미연결 사유는
해당 동작 가까이에 짧게 표시하고, 개발용 예시 모드는 실제 실행과 구분해 표시합니다.

빌드된 작업 화면은 `vite build`가 만든 `packages/client/dist/static`을 Node가 서빙하고 API를
프록시하며 `pnpm --filter @safehandoff/client start`로 실행합니다. 개발 실행(`just client`,
`just fake-app`)은 같은 Node 서버에 Vite 미들웨어를 붙이며 HMR과 WebSocket을 쓰지 않으므로 편집
뒤 브라우저를 새로고침합니다. 고정 Node 버전의 네이티브 설정 로더로 Vite 설정을 읽어
`node --watch`가 임시 설정 번들 때문에 반복 재시작하지 않게 합니다.

main을 병합한 뒤에는 legacy `/api/analysis`와 `/api/documents`도 같은 세션 경계를 따릅니다. 세션이
열려 있으면 화면이 CSRF 토큰을 함께 보내고, 인증 경계가 꺼진 서버(fake-app, workflow 미설정)는 기존
호출을 그대로 유지합니다. 병합 트리를 실제 브라우저로 확인한 기록은 다음과 같습니다. 가상
`ModelClient`와 실제 `RealCore`, `WorkflowSessions`, `createWorkflowHandler`, `createApp`을 하나의
세션 구성으로 묶어 세션 열기, 분석 후보 1개 표시, 내부 메모 저장과 목록 조회까지 확인했고, 경계를
끈 별도 `createApp` 서버에서도 세션 없이 메모 저장과 조회를 확인했습니다. 두 경우 모두 외부 모델
API를 호출하지 않았습니다. 병합 직후에는 세션 토큰이 도착하기 전에 시작한 초기 문서 조회가 401로
끝나 새 조회가 누락되는 경쟁이 있었다. `useDocuments`의 효과가 진행 중 조회를 마친 뒤 다시 load하도록
수정했고, `documents-refresh.test.ts`에 소비자 records 상태를 확인하는 검사를 하나 추가했습니다.
이 확인은 앞 절의 React 전환 시점 192개 통과 기록과 별개이며, QG 최종 통과를 뜻하지 않습니다.

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
