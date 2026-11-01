# SafeHandoff 구현 계획 - 해커톤 2일 수직 슬라이스 / 5인 팀 분담 / 제품 마일스톤

문서 버전: 2.1 / 기준일: 2026-10-31 / 상태: 현행 정본 (TypeScript 워크스페이스 기준) / 연결: [prd.md](prd.md), [acceptance-map.csv](../qa/acceptance-map.csv), [traceability.csv](../qa/traceability.csv)

## 현재 범위 변경

2026-11-01의 삭제 및 선택적 후속 검토는 [삭제 기능과 후속 검토](deferred-features.md)가 정본이다.
아래 마일스톤의 과거 완료 기록은 제거된 화면·API가 현재도 제공된다는 의미가 아니다.
후속 기능을 추가할 때 해당 문서의 DF 식별자부터 확인한다.

## 1. 해커톤 2일(48시간) 수직 슬라이스 정의 (`H1-H4`)

전체 제품 설계(`F01-F10`, 수용 기준 127개)를 이틀 안에 모두 웹 화면까지 완결하는 것은 불가능하다. 따라서 해커톤 마감 기준은 **"원자료 파싱/분석 -> 공개 수준 결정/결정적 변환 -> 승인팩(`FactPack`) 전용 작성/기본 거부 검토 -> 무인터넷 Docker 합성 재현 -> 3자 가치 비교 실험"이 실제 TypeScript 코드와 자동화 테스트로 끝까지 이어지는 핵심 수직 슬라이스(`H1-H4`)**로 정의한다.

### 1.1 해커톤 수직 슬라이스 단계 (`H1-H4`)

| 해커톤 단계 | 목표 시점 | 수직 슬라이스 범위 | 구현 패키지 / 산출물 | 현재 상태 |
| --- | --- | --- | --- | --- |
| `H1` | Day 1 오전 | **도메인 계약 / SQLite 저장소 / 분리 실행 서버/클라이언트** | `@safehandoff/core-interface`, `@safehandoff/server`(`DocumentStore` + `TaskStore` 11개 테이블/CAS), `@safehandoff/app`(`:8080`), `@safehandoff/fake-app`(`:8081`), `@safehandoff/client` | 완료 (단위/통합 테스트 통과) |
| `H2` | Day 1 오후 | **근거 추출(`F02`) / 결정 투영/변환(`F03`) / 승인팩 작성/기본 거부 검토(`F04/F06`)** | `parseSources`, `RealCore.analyze()`, `POST /api/analysis`, `TaskStore.analysis`, `composeFactPack()`, `builtin-tools` 5종(`100/141/212` 지수, 추이, 인용 `[가림]`), `groundFacts()`, `RealCore.writeReviewed()`, UI `analysis-view.ts`/`disclosure-view.ts` | 완료 (단위/통합 테스트 및 라이브 스모크 통과) |
| `H3` | Day 2 오전 | **제품 지침 팩(`F07`) / 무인터넷 Docker 4회 합성 재현(`F08`) / 실행 Transcript** | `FsSkillPackLoader`(`load`/`verify`), `pack-register.mjs`, `DockerReproRunner`(`--network=none`, 고정 oracle), `FileTranscriptSink`(`transcript.v1`), `oss-repro-smoke.mjs` | 완료 (단위 테스트 및 Docker 종단간 스모크 통과) |
| `H4` | Day 2 오후 | **CDP 시연 녹화 / 127개 AC 매핑 / 발표 정합성 감사** | 당시 `scripts/demo/*`(`fake-app` `/__presentation`, 99.988초 녹화), `acceptance-map.csv`/`traceability.csv` 테스트 연결, `docs/presentation/` | 당시 완료. 전용 화면은 이후 제거하고 실제 client 기반 시연으로 교체했다. 당시 포함했던 3자 가치 비교 검증(`PRD-13`) 도구도 2026-10-31에 제거했다 ([구현 상태](submission-status.md)) |

### 1.2 기능별 127개 수용 기준(AC)의 해커톤 범위 분류

모든 127개 수용 기준(`AC-F01-01-AC-F10-12`)은 [acceptance-map.csv](../qa/acceptance-map.csv)의 `hackathon_scope` 열에서 세 가지로 명확히 구분한다.

- **`hackathon_core` (44개 AC)**: 해커톤 핵심 수직 슬라이스(`H1-H2`, `P0` 코어 엔진/저장소/모델 경계)에 포함된 수용 기준.
- **`hackathon_ext` (18개 AC)**: 해커톤 도메인 확장/합성 재현 슬라이스(`H3`, `P1` `SkillPack` 로더/내장 변환/Docker 재현)에 포함된 수용 기준.
- **`product_backlog` (65개 AC)**: 코어 계약과 DB 스키마는 준비되었으나, 전체 `/api/v1/tasks` REST 라우트/다중 화면(`UI-02-UI-10`)/세션/CSRF/ZIP 아카이브 엔드포인트 연결이 필요한 해커톤 이후 제품 백로그.

| 기능 ID | 기능 이름 | 원래 등급 | 전체 AC 수 | `hackathon_core` | `hackathon_ext` | `product_backlog` | 해커톤 내 자동 테스트 검증(`passed` / `partial`) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `F01` | 작업 시작과 원자료 등록 | P0 | 12 | 4 | 0 | 8 | 4 (`passed` 2, `partial` 2) |
| `F02` | 근거 추출과 공개 후보 제안 | P0 | 14 | 8 | 0 | 6 | 8 (`passed` 7, `partial` 1) |
| `F03` | 공개 범위/표현 수준 결정 (A/B/C/D) | P0 | 14 | 8 | 0 | 6 | 8 (`passed` 7, `partial` 1) |
| `F04` | 승인 정보로 새 작성과 작성 중 검토 | P0 | 15 | 10 | 0 | 5 | 10 (`passed` 9, `partial` 1) |
| `F05` | 최종 파일 확인/확정/다운로드 | P0 | 13 | 1 | 0 | 12 | 1 (`partial` 1) |
| `F06` | 같은 조건에서 공개 기준 다시 쓰기 (`Rule`) | P0 | 11 | 5 | 0 | 6 | 5 (`passed` 5) |
| `F07` | 제품별 제보 지침(`SkillPack`)과 맥락 검사 | P1 | 12 | 0 | 6 | 6 | 6 (`passed` 4, `partial` 2) |
| `F08` | 새 합성 입력으로 관찰한 문제 확인하기 | P1 | 12 | 0 | 12 | 0 | 12 (`passed` 9, `partial` 3) |
| `F09` | 진행/이력/중단 복구/작업 삭제 | P0 | 14 | 4 | 0 | 10 | 4 (`passed` 2, `partial` 2) |
| `F10` | 내부 실행과 접근 경계 | P0 | 12 | 4 | 0 | 8 | 4 (`passed` 4) |
| **합계** | **10개 기능 (`F01-F10`)** | **P0 8 / P1 2** | **127** | **44** | **18** | **65** | **62 (`passed` 49, `partial` 13, `not_run` 65)** |

---

## 2. 실제 5인 팀 역할 분담과 Git 커밋 구조

초기 기획 템플릿에 남아 있던 가상 3인(A/B/C) 분담표를 폐기하고, 실제 해커톤을 수행한 **5인 팀([SafeHandoff_팀원_소개.html](../presentation/SafeHandoff_팀원_소개.html) 기준)의 역할 분담과 Git 커밋 집중 경위**를 투명하게 기록한다.

### 2.1 5인 팀원별 담당 영역

| 팀원 | 역할 | 담당 기능 (`F01-F10`) 및 산출물 | 주요 관련 경로 |
| --- | --- | --- | --- |
| **맹주영 (`Juyeong Maing`)** | 코어 엔진 / 분석/검토 / 샌드박스 / 통합 리드 | `F02`(`RealCore.analyze`, `TaskStore.analysis`, `POST /api/analysis`)/`F04`(작성/검토)/`F08`(Docker 재현)/`F10`(실행 경계) 구현, 9개 TypeScript 패키지 설계, 로컬 LLM/Docker 스모크 및 `main` 브랜치 통합 | `packages/core-interface`, `packages/core`, `packages/model-adapter`, `packages/sandbox-runner`, `packages/skill-loader`, `packages/server` |
| **김민성 (`servercat`)** | 프론트엔드 UI / 공개 결정 / 분석 화면 연결 | `F01`/`F02`/`F03` 작업 화면(`Swiss Grid`), 후보별 공개 결정(`disclosure-state.ts`, `disclosure-view.ts`), 원자료 분석 UI 연결(`analysis-state.ts`, `analysis-view.ts`) 구현 | `packages/client/src/`, `packages/client/public/` |
| **임재홍 (`andy1398`)** | CDP 시연 자동화 / 제출 영상 녹화 / 검증 | 당시 `fake-app` 전용 화면과 자막/장면 탐색/재생 제어(`scripts/demo/*`), 99.988초 제출 영상 녹화 및 해시 검증. 전용 화면과 tracked 영상은 이후 제거됨 | `scripts/demo/`, `docs/presentation/video/` 출처 기록 |
| **김병철** | 도메인 계약 / 수치 변환 / 재사용/확장 규칙 설계 | `F03`/`F05` 계약(`contracts/*.schema.json`), `builtin-tools` 수치/시계열/인용 변환(`100/141/212`, `[가림]`), `F06` `groundFacts` 기본 거부 및 `F07` `SkillPack` 규칙 설계 | `contracts/`, `docs/features/`, `fixtures/skills/` |
| **이상혁 (`dbralfk12-stack`)** | 발표 패키지 / 3자 가치 비교 실험 / 추적성 검증 | 발표 슬라이드 구성(`docs/presentation/`), 공개 통계 기반 TAM/SAM/SOM 산식 검증, 가상 로그 10건 3자 비교 실험(해커톤 당시 `tools/value-comparison.mjs`, `effect-measure.mjs`로 실행 - 2026-10-31 도구 제거, [구현 상태](submission-status.md)), 127개 AC 매핑 | `docs/presentation/`, `docs/acceptance-map.csv` |

### 2.2 Git 커밋 이력과 협업 방식 설명

저장소 커밋 이력에서 초기 56개 커밋 시점에는 통합 리드(`Juyeong Maing` 50개) 중심으로 코어/문서/도구 커밋이 집중되고 UI(`servercat` 5개)/발표(`이상혁` 1개)가 별도로 기록되었으며, 이후 후반 통합 라운드에서 UI(`servercat` 14개)/CDP 시연(`andy1398` 7개)/발표/평가(`이상혁`) 커밋이 [BRANCHING_STRATEGY.md](../../BRANCHING_STRATEGY.md)(Trunk-Based Development)에 따라 병합되었다.

1. **엄격한 품질 게이트(`.qg.yaml`)와 통합 워크스테이션 중심 초기 부트스트랩**:
   - 본 저장소는 `pnpm typecheck`, `pnpm test`, `tools/qg.test.mjs`, `tools/validate_docs.py`가 모든 패키지 타입/문서 링크/허용 문자 집합/파일 줄 수를 동시에 검사한다.
   - 특히 로컬 LLM 엔드포인트와 `safehandoff-runner` Docker 이미지가 통합 리드의 워크스테이션에 먼저 구성되어 있었기 때문에, 도메인 스키마/변환 수식/기획 명세도 페어 리뷰 후 통합 워크스테이션에서 빌드/검증을 거쳐 커밋했다.
2. **모듈 경계 확립 이후 역할별 병렬 커밋 (`feat/hackathon-ui`, `feat/cdp-demo-presentation`, `docs/presentation-update`)**:
   - `Core` 인터페이스와 HTTP 경계가 고정된 뒤에는 클라이언트 공개 결정/분석 UI(`servercat`), CDP 자동 시연/제출 영상 녹화(`andy1398`), 발표 슬라이드/가치 비교 실험(`이상혁`)을 각자 브랜치와 `main`에서 병렬로 커밋/통합했다.
3. **기여 투명성 원칙**:
   - 위 표의 기능 배정은 팀원별 설계/검토/구현 참여 영역을 나타내며, 미연결 백로그(`product_backlog`)까지 모두 구현 완료했다는 뜻으로 부풀리지 않는다 ([docs/presentation/ISSUES.md](../presentation/ISSUES.md) `PRES-02`).

---

## 3. 전체 제품 단계별 마일스톤 (`M0-M5`)

해커톤 수직 슬라이스(`H1-H4`)를 기반으로 전체 제품(`F01-F10` 127개 AC)을 완성하는 6단계 제품 로드맵이다.

| 제품 마일스톤 | 목표 | 해커톤(`H1-H4`) 내 완료된 부분 | 해커톤 이후 남은 백로그 (`product_backlog`) |
| --- | --- | --- | --- |
| `M0` | **기반 계약 / 실행 경계 / 저장소 골격 (`F01`, `F10`)** | 9개 패키지 구조, `contracts/*.schema.json`, SQLite `DocumentStore` + `TaskStore` 7개 테이블, `HttpModelClient`, `/api/health`/`/api/core/status` | 시작 토큰 없는 자동 연결(`/api/v1/session`), 내부 8시간 쿠키 세션, CSRF/Host/Origin 미들웨어 전체 라우트 적용 |
| `M1` | **원자료 근거 파싱 / 분석 / 공개 결정 투영 (`F01`, `F02`, `F03`)** | `parseSources`(txt/md/csv/json 근거 ID), `RealCore.analyze()`, `composeFactPack()`, `builtin-tools` A/B/C/D 변환(`100/141/212`, `기준/증가/감소`, `[가림]`) | 다중 파일 업로드 HTTP API(`/api/v1/tasks/{id}/sources`), UI-04/05 선택 카드/미리보기 해시 저장 API 연결 |
| `M2` | **승인팩 전용 작성 / 기본 거부 검토 / 수리 루프 (`F04`, `F05`)** | `RealCore.write()`, `review()`, `writeReviewed()`(고정 `reason_code` 1회 수리), `/api/core/generate` 연결, `FileTranscriptSink`(`transcript.v1`) | DocAST 블록 수동 편집 API, `human-review` 체크리스트 저장, `manifest.json` 및 결정적 ZIP 아카이브 다운로드 API(`/api/v1/exports`) |
| `M3` | **공개 표현 기준(`Rule`) 조건부 재사용 (`F06`, `F09`)** | `Rule`/`Scope` 타입 계약, `groundFacts()` 결정적 검증(`exact_value`/`approved_excerpt` 재사용 차단, 만료/철회/범위/`goal_variant` 불일치 차단), `TaskStore` revision CAS | 서버 `rules` 테이블 CRUD API(`/api/v1/rules`), 분석 채택 시 규칙 자동 매칭, UI-07/08 이력/작업 삭제(`DELETE` 확인) 화면 연결 |
| `M4` | **제품별 지침 팩(`SkillPack`) / 합성 입력 Docker 재현 (`F07`, `F08`)** | `FsSkillPackLoader`(`load`/`verify`, `O_NOFOLLOW`), `pack-register.mjs`, `make_synthetic_inputs_v1`, `DockerReproRunner`(`--network=none`, 4회 실행 고정 oracle), `oss-repro-smoke.mjs` | `check_doc_ip_context_v1` 컨테이너 프로세스 어댑터 연결, UI-09 확장 카탈로그 상태 조회 화면 |
| `M5` | **가치 비교 실험 / 수신자 충분성 검증 / 품질 게이트 (`PRD-13`)** | 48개 자동 테스트 스위트, 127개 AC/60개 QA 추적표 연결. 해커톤 당시 가상 로그 10건 결정적 3자 비교 도구를 만들었으나 2026-10-31에 제거했다 ([구현 상태](submission-status.md)) | 가상 로그 10건 결정적 3자 비교와 2인 교차 참여자 스톱워치 작업 시간 측정(10건 완주) 도구를 다시 만들고 실제 사내 도입 파일럿(`Q-LLM`, `Q-POLICY`)을 수행 |

---

## 4. 품질 게이트 및 완료 확인 절차

새로운 기능을 `product_backlog`에서 구현 완료(`passed`)로 전환할 때는 다음 4단계를 모두 통과해야 한다.

1. `pnpm build && pnpm typecheck` - 9개 패키지 전체 TypeScript 컴파일 및 타입 검사 통과.
2. `pnpm test` - 패키지별 단위/통합 테스트 및 `tools/*.test.mjs`(`architecture`, `qg`, `pack-register`, `toyrecord-pack`, `oss-repro-smoke`) 전체 통과.
3. `python tools/validate_docs.py` - `intent.md` -> `prd.md` -> `features/01-10` -> `acceptance-map.csv` -> `traceability.csv` 참조 무결성 및 테스트 파일 존재 검증 통과.
