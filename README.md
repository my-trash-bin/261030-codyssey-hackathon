# SafeHandoff

사내 로그/표/운영 메모를 외부(오픈소스 메인테이너, B2B 기술지원 공급사, 외부 운영 자문사)에 공유할 때, **무엇을 어느 수준으로 공개할지 사람이 미리보기로 결정하면 승인된 사실(`FactPack`)만으로 새 공유 문서/표/합성 재현 예제를 작성하고 검토하는 로컬 설치형 도구**입니다.

원본 문서를 통째로 모델에 넣어 마스킹만 시키는 대신, **원자료 분석(`Analyst`) -> 사람의 공개 수준 결정(`A/B/C/D`) 및 결정적 변환(`builtin-tools`) -> 승인팩 전용 작성(`Writer`) -> 기본 거부 Grounding 및 검토(`Reviewer`) -> 무인터넷 Docker 합성 재현(`DockerReproRunner`)**의 입력/권한 경계를 분리합니다.

---

## 1. 한눈에 보는 정본 문서

| 읽을 순서 | 문서 | 설명 |
| --- | --- | --- |
| 1 | [intent.md](intent.md) | 사용자 확정 의도 원문 (`INT-01-INT-12`) |
| 2 | [docs/prd.md](docs/prd.md) | **현행 제품 요구사항 정본 (`PRD-01-PRD-14`)** - 해커톤 구현 범위 vs 전체 제품 목표 한 장 요약 |
| 3 | [docs/plan.md](docs/plan.md) | **해커톤 2일 수직 슬라이스(`H1-H4`)** vs 제품 마일스톤(`M0-M5`), **5인 실제 팀 역할 분담 및 커밋 구조** |
| 4 | [docs/검증보고서.md](docs/검증보고서.md) | **통합 검증 보고서** - 48개 테스트 스위트, **직접 가림 vs 일반 AI vs SafeHandoff 10건 비교 실험**, Docker 스모크 결과 |
| 5 | [docs/acceptance-map.csv](docs/acceptance-map.csv) / [docs/traceability.csv](docs/traceability.csv) | 127개 수용 기준(`AC-F01-01-AC-F10-12`) 및 60개 QA 시험(`T01-T60`)과 자동화 테스트 파일 매핑 |
| 6 | [docs/architecture.md](docs/architecture.md) / [docs/api.md](docs/api.md) / [docs/ERD.md](docs/ERD.md) | TypeScript 9개 패키지 구조, HTTP/엔진 API 계약, SQLite 스키마 |
| 7 | [docs/decisions.md](docs/decisions.md) / [docs/spec.md](docs/spec.md) / [docs/security.md](docs/security.md) | 설계 결정(`D01-D24`, Go -> TypeScript 전환 경위 포함), 상태/불변조건(`INV-01-16`), 실행 보안 경계 |
| 8 | [docs/agent-workflow.md](docs/agent-workflow.md) / [docs/extensions.md](docs/extensions.md) | 역할별 JSON 계약/`groundFacts`/`transcript.v1` 및 `SkillPack`/내장 변환/Docker 재현 계약 |
| 9 | [docs/IA.md](docs/IA.md) / [docs/uj.md](docs/uj.md) / [docs/demo.md](docs/demo.md) | 화면 구조(`UI-01-10`), 사용자 여정(`UJ-01-07`), 로컬/Docker 시연 절차 |
| 10 | [docs/features/01-task-intake.md](docs/features/01-task-intake.md) - [10-runtime-boundary.md](docs/features/10-runtime-boundary.md) | 기능 단위 명세 (`F01-F10`) |
| 11 | [docs/presentation/ISSUES.md](docs/presentation/ISSUES.md) / [GUIDE.md](docs/presentation/GUIDE.md) | 발표 슬라이드와 실제 코드 사이의 차이 관리(`PRES-01-12`) 및 발표 가이드 |

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
| `@safehandoff/client` | 웹 클라이언트 (`:5173` / `:5174`) | Swiss Grid UI, 원자료 분석 연결(`analysis-view.ts`, `POST /api/analysis`), 후보별 공개 결정 화면(`disclosure-view.ts`), 문서 보관소 |

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

`.env.example`을 참고해 `.env`에 OpenAI 호환 LLM 연결 정보(`SAFEHANDOFF_LLM_BASE_URL`, `SAFEHANDOFF_LLM_MODEL`, `SAFEHANDOFF_LLM_API_KEY`)를 설정합니다.

```sh
# 실제 앱 (:8080) + 웹 클라이언트 (:5173)
just app
just client

# LLM 없이 시연 흐름을 확인하는 가짜 앱 (:8081) + 웹 클라이언트 (:5174)
just fake-app
just client-fake
```

### 3.3 UI용 task/공개 결정 HTTP

SAFEHANDOFF_WORKFLOW_TOKEN(32자 이상)을 설정하면 실제 앱에서 세션/CSRF/Host/Origin/revision/멱등 키를 검사하는 인증된 v1 task API(task 생성/원자료 교체/분석 job/CAS/수동 후보/미리보기/결정 배치/철회)를 사용할 수 있습니다. HTTP loopback/단일 운영자 개발용이며 미설정/fake-app은 WORKFLOW_API_DISABLED입니다. 상세 DTO는 [docs/api.md](docs/api.md) 5, 남은 UI 연결은 [docs/ui-api-requests.md](docs/ui-api-requests.md)를 따릅니다.

### 3.4 3자 가치 비교 실험, CDP 시연 및 OSS Docker 재현 스모크

```sh
# 가상 사례 10건(금지 항목 48개, 필수 단서 32개) 결정적 3자 비교 실험 실행
node --conditions=development tools/value-comparison.mjs

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

자세한 시연 시나리오/제출 영상(`docs/demo-media/SafeHandoff-demo.mp4`)/과거 영상 참고자료([docs/presentation/video/README.md](docs/presentation/video/README.md))는 [docs/demo.md](docs/demo.md), 검증 수치와 근거는 [docs/검증보고서.md](docs/검증보고서.md)에서 확인할 수 있습니다.

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
