# SafeHandoff 제품 요구사항 정의서 (PRD)

문서 버전: 2.0 / 기준일: 2026-10-31 / 상태: 현행 정본 (TypeScript 워크스페이스 기준) / 상위 기준: [intent.md](../intent.md) (`INT-01-INT-12`)

## 0. 한 장 요약 - 지금 무엇을 만드는가

**SafeHandoff**는 회사 내부 로그/표/운영 메모를 외부(오픈소스 메인테이너, B2B 기술지원 공급사, 외부 운영 자문사)에 공유할 때, **무엇을 어느 수준으로 공개할지 사람이 미리보기로 결정하면 승인된 사실(`FactPack`)만으로 새 공유 문서/표/합성 재현 예제를 작성하고 검토하는 내부 설치형 도구**다. 원본 문서를 통째로 모델에 넣어 마스킹만 시키는 대신, 원자료 분석(Analyst)과 승인 정보 기반 작성(Writer)/검토(Reviewer)/결정적 변환(Builtin Tools)/격리 재현(Docker Repro Runner)의 입력 경계를 분리한다.

### 현재 해커톤 수직 슬라이스 구현 범위 vs 전체 제품 목표

| 구분 | 지금 해커톤에서 실제 구현/검증된 범위 (`H1-H4`) | 전체 제품 목표 (`PRD-01-14` / `F01-F10`) |
| --- | --- | --- |
| 실행 스택 (`PRD-03`) | TypeScript + Node 24 + `node:sqlite` + React 19 (`pnpm` 9개 패키지: `core-interface`, `core`, `model-adapter`, `sandbox-runner`, `skill-loader`, `server`, `app`, `fake-app`, `client`) | 동일 TypeScript 단일 설치형 서버/웹 UI에 세션 인증/SSE/ZIP 내보내기까지 통합 |
| 작업/문서 입력 (`PRD-04`, `F01`) | `packages/server` SQLite 문서 저장/조회/삭제 HTTP API 및 `TaskStore` 11개 워크플로우 테이블(migration v2)/CAS 구현 | 다중 파일 배치 업로드 및 작업(`task`) CRUD HTTP API 연결 |
| 근거 추출 (`PRD-05`, `F02`) | `RealCore.analyze()` (`candidate_proposals.v1` 엄격 검증, UTF-8 byte range/CSV/JSON 근거 파서), `POST /api/analysis` HTTP 라우트, `TaskStore.analysis`/`runTaskAnalysis` CAS 채택, 작업 화면 `analysis-view.ts` 파일 분석 연결 | `TaskStore.analysis`와 웹 UI 간 작업 단위 영속 조회/폴링 HTTP 연결 |
| 공개 수준 결정 (`PRD-05/06`, `F03`) | `composeFactPack()` + `builtin-tools` 5종(A 사실 요약, B 추이 표 `기준/증가/감소`, C 선택 필드, D 상대지수 `100/141/212`, 승인 인용 `[가림]`), 클라이언트 `disclosure-view.ts` 후보별 결정/미리보기/일괄 적용 UI | 서버 미리보기 해시 바인딩 HTTP 라우트 및 자연어 조건 해석(`interpret_disclosure`) 실행기 연결 |
| 새 작성/검토 (`PRD-07/08`, `F04`) | `RealCore.write()` / `review()` / `writeReviewed()` (원문 미전달 `FactPack` 전용 작성, `groundFacts` 기본 거부, `fixed reason code` 1회 자동 수리, `/api/core/generate` HTTP 연결) | DocAST 블록별 수동 편집 UI, `human-review` 체크리스트 API 및 최종 번들 렌더러 |
| 기준 재사용 (`PRD-09`, `F06`) | `Rule`/`Scope` 계약 및 `groundFacts()` 결정적 검증(`exact_value`/`approved_excerpt` 재사용 차단, 만료/철회/범위 불일치 시 모델 호출 전 차단) | 서버 `rules` 테이블 CRUD/자동 매칭 API 및 UI-08 규칙 관리 화면 |
| 도메인 확장/재현 (`PRD-10/11`, `F07/F08`) | `FsSkillPackLoader`(manifest/경로/심볼릭링크/SHA-256 지문 검증), `pack-register` CLI, `DockerReproRunner`(`--network=none`, 4회 실행 oracle 판정), `oss-repro-smoke` 종단간 실행 | UI-09 확장 카탈로그 조회 API 및 `check_doc_ip_context_v1` 컨테이너 프로세스 어댑터 |
| 가치/품질 검증 (`PRD-13`) | 48개 자동 테스트 스위트 통과 | 가상 사례 10건 3자 결정적 비교 실험과 참여자 스톱워치 기반 사람 작업 시간 측정 (해커톤 당시 도구를 만들었으나 2026-10-31 제거, [decisions.md](decisions.md)) |

---

## 1. 문제 정의와 제품 핵심 원칙

외부에 기술 문제를 문의하거나 운영 자문을 구할 때, 실무자는 원본 자료에서 민감한 고객명/내부 경로/사업 수치를 빼고 상대가 이해할 수 있는 설명/표/재현 예제를 다시 만들어야 한다. 직접 수작업으로 가리면 시간과 누락 부담이 크고, 일반 AI에 원문을 그대로 맡기면 공개하지기로 한 정보나 추측성 단정이 초안에 섞이기 쉽다.

SafeHandoff는 세 가지 원칙으로 이 문제를 푼다.

1. **가림(Redaction)이 아니라 승인 정보 기반 새 작성(Authorized Composition)**: 원본 문서를 지운 흔적 투성이로 내보내지 않고, 사람이 승인한 사실/변환 표/합성 입력만으로 목적에 맞는 새 공유본을 구성한다 (`U02`, `U05`).
2. **모델 추론과 권한 결정의 분리**: 분석 모델은 근거에 연결된 후보만 제안하고, 공개 여부와 표현 수준(A/B/C/D)은 사람과 결정적 앱 코드가 확정한다. 작성 모델(`Writer`)은 원자료 없이 승인팩(`FactPack`)만 받는다 (`D04`, `INV-04`).
3. **고정 계약과 결정적 검증 우선**: 재사용 규칙의 범위/만료/철회, 필수 사실 포함 여부, 수치 상대지수(`100/141/212`), Docker 4회 재현 판정은 프롬프트 지시에만 맡기지 않고 TypeScript 코드와 JSON Schema로 먼저 강제한다 (`D06`, `D10`).

---

## 2. 결정 분류 체계 (`U` / `D` / `Q`)

| 기호 | 의미 | 변경 규칙 |
| --- | --- | --- |
| `U` | 사용자 확정 방향 ([intent.md](../intent.md) `INT-01-INT-12`에 직접 근거) | 사용자 승인 없이 변경 불가 (`U01-U12`) |
| `D` | 구현 가능성을 위해 팀이 고정한 기본 설계 (`D01-D24`) | 더 나은 대안이 있으면 근거와 함께 [decisions.md](decisions.md), [spec.md](spec.md), [ERD.md](ERD.md), [api.md](api.md)를 동시에 갱신 |
| `Q` | 실제 기업 도입/운영 시 확인이 필요한 질문 (`Q-LLM`, `Q-POLICY`, `Q-EXT`, `Q-DEPLOY`, `Q-LICENSE`) | 미확인 상태에서도 가상 자료와 고정 인터페이스로 구현/검증 가능하도록 격리 |

### 사용자 확정 항목 (`U01-U12`)

- **U01 (`INT-01`)**: 외부 공유용 기술/운영 자료를 준비하는 사람의 수고를 줄이는 것이 핵심 가치다.
- **U02 (`INT-02`, `INT-05`)**: 단순 마스킹 도구가 아니라 목적에 맞는 새 설명문/표/재현 예제를 작성하는 도구다.
- **U03 (`INT-03`)**: 오픈소스 버그 제보, B2B 기술지원 문의, 일반 내부 자료 기반 외부 운영 자문의 3대 시나리오를 지원한다.
- **U04 (`INT-04`)**: 로컬/사내 설치형 오픈소스 웹 애플리케이션과 지정 LLM 엔드포인트 구조를 기본으로 한다.
- **U05 (`INT-05`)**: 공개 범위를 한 번에 강요하지 않고 초안 작성/검토 중에도 질문하고 조정하는 대화형 흐름을 지원한다.
- **U06 (`INT-06`)**: 요청량 등 수치 정보는 **A. 구체적인 데이터 없이 사실만**, **B. 추이만 보이게 나머지 마스킹**, **C. 요청 정보 마스킹**, **D. 기타 (직접 입력)** 선택지를 제공한다.
- **U07 (`INT-07`)**: 사용자가 실제로 반출될 최종 파일을 눈으로 확인한 뒤 복사/다운로드한다 (자동 외부 전송 금지).
- **U08 (`INT-08`)**: 오픈소스/공급사별 제보 지침(`SkillPack`)과 맥락 기반 예외 검사를 확장할 수 있게 한다.
- **U09 (`INT-09`)**: 같은 목적/수신처/자료 구조에서 이전 공개 표현 기준(`Rule`)을 재사용하되 새 자료의 값은 다시 계산한다.
- **U10 (`INT-10`)**: 준비된 실행 환경이 있을 때 회사 원자료 대신 합성 입력으로 오류 재현 여부를 검증한다.
- **U11 (`INT-11`)**: 직접 준비 vs 일반 AI vs SafeHandoff 비교와 수신자 관점의 정보 충분성으로 가치를 검증한다.
- **U12 (`INT-12`)**: 자동 티켓 전송, 중앙 SaaS, 모든 소프트웨어의 범용 자동 재현, 유출 0% 절대 보장은 약속하지 않는다.

---

## 3. 사용자와 대상 시나리오

- **작성자 (Primary User)**: 사내 로그/CSV/운영 문서를 바탕으로 외부에 공유할 문의문이나 제보 패키지를 준비하는 개발자/운영 담당자.
- **수신자 (Downstream Reader)**: 공개된 파일만 받아 문제를 파악하거나 조사를 이어가는 오픈소스 메인테이너, B2B 공급사 엔지니어, 외부 자문역. SafeHandoff 내부 DB나 원자료에 접근하지 않는다.

| 시나리오 ID | 업무 목적 (`purpose_id`) | 수신 범위 (`audience`) | 대표 원자료 (`fixtures/reference-pack/author/`) | 기대 산출물 |
| --- | --- | --- | --- | --- |
| 사례 A (`UJ-01`) | `oss_bug_report` (오픈소스 버그 제보) | `public` | `oss-encoding/` (`toyrecord` 다중 바이트 인코딩 오류 로그/메모/관찰표) | 고객 문자열 없는 제보문 + 6글자 합성 입력 + buggy/fixed 4회 실행 결과 |
| 사례 B (`UJ-02`) | `vendor_support` (B2B 기술지원 문의) | `named_external` | `b2b-timeout/` (`VendorStore` 타임아웃/재시도 로그/요청량 표) | 관찰 사실과 서버 처리 미확인(`unknown`)을 분리한 기술지원 문의문 |
| 사례 C (`UJ-03`) | `operations_advisory` (외부 운영 자문) | `named_external` | `internal-operations/` (`820/1160/1740` 요청량 CSV/업무 인수인계 메모) | 선택한 표현 수준(A 사실/B 추이/C 선택 필드/D 상대지수)의 자문 요청서와 표 |

---

## 4. 상세 제품 요구사항 (`PRD-01-PRD-14`)

### PRD-01 / 핵심 목표 (`U01`, `U02`)
사용자가 원본 자료를 일일이 손으로 지우고 다시 문서화하는 반복 노동을 줄이면서, 수신자가 다음 행동을 취할 수 있는 완결된 공유 자료를 준비하게 한다.

### PRD-02 / 3대 지원 시나리오 (`U03`)
오픈소스 버그 제보(`oss_bug_report`), 재현 환경 없는 B2B 기술지원 문의(`vendor_support`), 일반 내부 운영 자료 기반 외부 자문(`operations_advisory`)을 같은 근거/결정/작성/검토 파이프라인 위에서 처리한다.

### PRD-03 / 내부 설치형 TypeScript 런타임과 지정 LLM 연결 (`U04`, `D01`)
- **현행 아키텍처**: Node 24와 TypeScript 기반 `pnpm` 워크스페이스로 구성하며, 서버는 `node:sqlite` 단일 파일 DB를 사용하고 기본 `127.0.0.1` 루프백(또는 운영자가 명시한 내부 인터페이스)에서 동작한다.
- **패키지 경계**: 순수 도메인 계약(`@safehandoff/core-interface`), 분석/승인팩/작성/검토/내장 변환 엔진(`@safehandoff/core`), OpenAI 호환 HTTP 모델 어댑터(`@safehandoff/model-adapter`), 무인터넷 Docker 재현 실행기(`@safehandoff/sandbox-runner`), 파일시스템 지침 팩 로더(`@safehandoff/skill-loader`), SQLite/HTTP 서버(`@safehandoff/server`), 실행 앱(`@safehandoff/app`, `@safehandoff/fake-app`), React 웹 클라이언트(`@safehandoff/client`)로 분리한다.
- **데이터 경계**: 원자료는 지정된 모델 엔드포인트 외의 외부 네트워크로 전송하지 않으며, 작성기(`Writer`)에는 원자료 대신 승인된 `FactPack`만 전달한다.

### PRD-04 / 작업 생성과 불변 원자료 등록 (`U03`, `D03`, `F01`)
작업 생성 시 목적(`purpose_id`), 목표 변형(`goal_variant`), 수신자(`recipient_id`), 공개 범위(`audience`), 결과 언어를 고정한다. 입력 자료(`.txt`, `.md`, `.csv`, `.json`)는 원본 바이트와 SHA-256 해시를 보존하며, 자료를 업로드하거나 메모를 적은 행위 자체를 공개 승인으로 간주하지 않는다.

### PRD-05 / 근거 기반 후보 추출과 대화형 공개 범위 조정 (`U05`, `F02`, `F03`)
분석 단계(`RealCore.analyze`)는 원자료의 정확한 위치(`evidence_id`, UTF-8 byte range, CSV 행/열, JSON Pointer)에 연결된 관찰(`observation`), 가설(`hypothesis`), 미확인(`unknown`), 업무 제약(`constraint`), 수치 시계열(`series`) 후보를 추출한다. 작성/검토 중 추가 공개 결정이 필요하면 임의로 원문을 끌어쓰지 않고 사용자 결정 단계(`needs_decisions`)로 돌아간다.

### PRD-06 / 4가지 표현 수준 선택지 A / B / C / D (`U06`, `D06`, `F03`)
수치/민감 후보에 대해 사용자는 실제 공개 미리보기를 확인하고 아래 네 가지 중 하나로 표현 수준을 결정한다.
- **A. 구체적인 데이터 없이 사실만**: 수치/관찰 횟수/간격 없이 승인된 추세 사실 문장만 전달한다 (예: `관찰된 구간에서 요청량이 증가했습니다.`).
- **B. 추이만 보이게 나머지 마스킹**: 원래 숫자와 시각을 제외하고 관찰 순서와 인접 증감 방향(`기준` / `증가` / `감소`)만 새 표로 만든다 (`series_direction_only.v1`).
- **C. 요청 정보 마스킹**: 사용자가 남기기로 선택한 열과 실제 값만 미리보기로 확인해 이번 작업에 한해 표로 포함한다 (`select_fields.v1`, 자동 재사용 불가).
- **D. 기타 (직접 입력)**: 자연어 조건을 등록된 결정적 변환으로 해석/계산해 미리보기 후 적용한다 (예: 첫 관찰을 100으로 둔 정수 상대지수 `series_index_base100.v1` -> `820/1160/1740`을 `100/141/212`로 변환).

### PRD-07 / 승인팩(`FactPack`) 전용 작성과 작성 중 검토 (`U02`, `U05`, `D04`, `F04`)
- 앱 코드는 유효한 `allow` 결정만으로 `FactPack`(`fact_pack.v1`)을 조립한다. `Writer` 호출에는 `FactPack`과 공개 양식만 전달하며 원자료/내부 파일명/리뷰어 자유 설명을 넘기지 않는다.
- 작성된 `DocAST`(`draft.v1`)는 구조/필수 사실(`required_fact_ids`) 검사와 `Reviewer`(`review.v1`) 검토를 거친다.
- 미승인 공개(`UNAPPROVED_DISCLOSURE`), 인과 단정(`UNSUPPORTED_CAUSAL_CLAIM`), 불확실성 삭제(`UNCERTAINTY_REMOVED`), 필수 사실 누락(`MISSING_REQUIRED_FACT`), 공개 결정 필요(`NEEDS_DISCLOSURE_DECISION`) 등이 발견되면 고정된 사유 코드와 승인된 `fact_id`만으로 제한 수리하거나 사용자 질문으로 되돌린다.

### PRD-08 / 최종 파일 확인과 수동 반출 (`U07`, `F05`)
사용자는 실제 공유될 본문/표/첨부 파일과 해시를 최종 확인한 뒤 확정하고, 확정된 동일 바이트를 클립보드 복사 또는 파일/ZIP으로 내려받는다. 외부 이슈 트래커나 메일로 자동 전송하는 기능은 두지 않는다.

### PRD-09 / 공개 표현 기준(`Rule`)의 조건부 재사용 (`U09`, `D10`, `F06`)
같은 `project_id`, `purpose_id`, `goal_variant`, `recipient_id`, `audience`, `skill_set_hash`와 검증된 자료 스키마(`selector`)에서는 이전에 저장한 변환 기준(`Rule`)을 다시 적용해 새 입력의 값을 재계산한다 (`820/780/1740` -> `기준/감소/증가`). 정확한 값(`exact_value`), 원문 인용(`approved_excerpt`), 실제값 선택 필드(`selected_fields`)는 절대 자동 재사용하지 않으며, `groundFacts()`가 만료/철회/범위 불일치를 모델 호출 전에 차단한다.

### PRD-10 / 제품별 제보 지침(`SkillPack`)과 맥락 기반 예외 검사 (`U08`, `D08`, `F07`)
오픈소스/공급사별 필수 확인 항목과 공개 양식을 `SkillPack`(`manifest.json`, `SKILL.md`, 역할별 참조 문서)으로 등록하고 SHA-256 지문으로 검증한다. 또한 단순 정규식 차단을 넘어, 승인된 새 설정 예시(`make_config_example_v1`) 안의 RFC 5737 문서용 IP(`192.0.2.0/24` 등)인지 판정하는 맥락 검사(`check_doc_ip_context_v1`) 계약을 지원한다.

### PRD-11 / 합성 입력 생성과 격리된 재현 검증 (`U10`, `D09`, `F08`)
재현 환경이 등록된 경우(`toyrecord-repro`), 원래 고객 문자열(7글자)을 변형하지 않고 공개 계약과 시드로 새 6글자 ASCII/한글 합성 입력(`make_synthetic_inputs_v1`)을 만든다. 네트워크가 차단된(`--network=none`) 읽기 전용 Docker 컨테이너에서 buggy/fixed 대상 x 2개 입력의 4회 실행과 결과 파일 바이트를 고정 oracle로 대조해 `reproduced`, `not_reproduced`, `inconclusive`, `error`, `not_run`을 정직하게 판정한다. 재현 환경이 없는 B2B 문의는 미실행(`not_run / no_environment`)을 명시한 관찰 문의로 완결한다.

### PRD-12 / 진행 이력/실행 기록(Transcript)/작업 삭제 (`D11`, `F09`, `F10`)
선택 변경 시 revision을 올려 이전 산출물을 즉시 `stale` 처리하고, 실행 단계와 모델 호출 메타데이터를 `transcript.v1` JSONL 및 이벤트로 기록한다. 작업 삭제 시 원자료/초안/결정/이력을 제거하되, 원문을 담지 않는 별도 재사용 규칙(`Rule`)의 보존 여부를 사용자에게 명확히 구분해 안내한다.

### PRD-13 / 가치 검증과 수용 기준 추적 (`U11`, `D12`)
1. **3자 비교 검증**: 가상 업무 로그 10건(금지 항목 43개/필수 단서 32개)에 대해 **직접 단순 마스킹** vs **미검토 원문 AI 생성** vs **SafeHandoff 파이프라인**의 금지 정보 노출/필수 단서 보존/미승인/만료 규칙 차단율을 결정적으로 비교 측정한다. 사람 참여자의 스톱워치 작업 시간 측정은 별도 실험으로 구분해 기록한다. 해커톤 당시 이를 실행하는 도구와 보고서를 만들었으나 2026-10-31에 저장소에서 제거했다 ([decisions.md](decisions.md)) - 이 수용 기준 자체는 남아 있으며 재구현이 필요하다.
2. **추적성**: `INT-01-12` -> `PRD-01-14` -> `F01-F10` -> 127개 수용 기준(`AC-F01-01-AC-F10-12`)과 60개 품질 시험(`T01-T60`)을 [acceptance-map.csv](acceptance-map.csv) 및 [traceability.csv](traceability.csv)에서 실제 자동 테스트 파일과 연결해 관리한다.

### PRD-14 / 약속하지 않는 것 (`U12`)
- **유출 위험 0% 절대 보장 불가**: 승인된 사실의 조합이나 도메인 맥락으로 추론되는 정보까지 수학적으로 완전 차단한다고 주장하지 않는다. 최종 반출 판단은 사람의 확인을 거친다.
- **범용 자동 버그 재현 불가**: 등록된 고정 재현 레시피(`toyrecord` 등) 밖의 임의 소프트웨어 버그를 자동으로 재현하거나 패치하지 않는다.
- **자동 외부 발송/중앙 멀티테넌트 SaaS 제외**: 외부 이슈 등록/메일 발송 자동화, 기업 간 비공개 원자료 공유, 조직 다단계 결재 워크플로우는 범위 밖이다.

---

## 5. 운영 확인 필요 항목 (`Q`)

| ID | 확인 대상 | 미확인 시 기본 설계 (`D`) |
| --- | --- | --- |
| `Q-LLM` | 사내 모델 엔드포인트 주소, 인증 방식, 최대 문맥 크기, 요청 로그 보관 정책 | OpenAI 호환 `/v1/chat/completions` 어댑터와 고정 fixture 모드를 함께 제공하고 기본 원문 디버그 로그는 끈다 |
| `Q-POLICY` | 실제 조직에서 외부 공유 승인 권한자, 보존 기한, 감사 로그 요구 수준 | 단일 로컬 사용자 세션 기준으로 구현하고 작업 삭제 시 즉시 제거한다 |
| `Q-EXT` | 첫 실제 도입 대상 오픈소스/공급사 제품의 필수 질문과 변환 규칙 | 가상 `toyrecord-repro`와 `vendorstore-support` 2개 팩으로 전체 확장 계약을 검증한다 |
| `Q-DEPLOY` | 사내 사용자 PC/폐쇄망 서버의 OS 및 Docker 컨테이너 실행 가능 여부 | Docker 미설치 환경에서도 호스트 셸로 우회하지 않고 `not_run / no_environment`로 안전하게 처리한다 |
| `Q-LICENSE` | 공개 재현 패키지에 포함할 대상 코드/양식의 외부 배포 라이선스 조건 | 자체 작성한 가상 코드 자산만 포함하고 등록 SHA-256 지문을 고정한다 |

---

## 6. 정본 문서 지도

| 문서 | 역할 |
| --- | --- |
| [intent.md](../intent.md) | 사용자 확정 의도 원문 (`INT-01-INT-12`, 수정 금지) |
| [docs/prd.md](prd.md) | 제품 요구사항 정본 (`PRD-01-PRD-14`, 현행 TypeScript 범위 요약) |
| [docs/plan.md](plan.md) | 해커톤 2일 수직 슬라이스(`H1-H4`), 제품 단계(`M0-M5`), 5인 팀 역할 분담과 커밋 구조 |
| [docs/decisions.md](decisions.md) | 아키텍처/도메인 결정 기록 (`D01-D24`, Go 초기 시제품 -> TypeScript 전환 경위 포함) |
| [docs/spec.md](spec.md) / [docs/security.md](security.md) | 상태 전이/불변조건(`INV-01-16`)/보안 경계 명세 |
| [docs/architecture.md](architecture.md) / [docs/ERD.md](ERD.md) / [docs/api.md](api.md) | 9개 TypeScript 패키지 구조, 현행 SQLite 테이블 + 전체 목표 ERD, HTTP/Core API 계약 |
| [docs/agent-workflow.md](agent-workflow.md) / [docs/extensions.md](extensions.md) | 에이전트 역할별 입출력/grounding/transcript 계약 및 `SkillPack`/내장 도구/Docker 재현 명세 |
| [docs/IA.md](IA.md) / [docs/uj.md](uj.md) / [docs/demo.md](demo.md) | 화면 구조(`UI-01-10`), 사용자 여정(`UJ-01-07`), 로컬/Docker 시연 절차 |
| [docs/features/01-task-intake.md](features/01-task-intake.md) - [10-runtime-boundary.md](features/10-runtime-boundary.md) | 기능 단위 상세 명세 (`F01-F10`) |
| [docs/qa.md](qa.md) / [docs/test-data.md](test-data.md) | 시험 기준(`T01-T60`), 가상 데이터 명세 |
| [docs/acceptance-map.csv](acceptance-map.csv) / [docs/traceability.csv](traceability.csv) | 127개 AC / 해커톤 범위 분류 / 자동화 테스트 연결 / 60개 QA 추적표 |
| [docs/presentation/ISSUES.md](presentation/ISSUES.md) / [GUIDE.md](presentation/GUIDE.md) | 발표자료와 실제 구현의 차이 관리(`PRES-01-12`) 및 발표 가이드 |
