# SafeHandoff HTTP API 및 코어 인터페이스 계약

문서 버전: 2.0 / 기준일: 2026-10-31 / 상태: 현행 정본 / 연결: [prd.md](prd.md), [architecture.md](architecture.md), [agent-workflow.md](agent-workflow.md), [extensions.md](extensions.md)

## 1. 현행 구현된 HTTP 엔드포인트 (`@safehandoff/server`)

아래 공통 API는 `packages/server`가 담당한다. `app`(`:8080`)과 `fake-app`(`:8081`)은 동일한 HTTP 라우터에 각자의 `Core` 구현만 주입한다. 원자료를 저장해도 자동 분석/외부 전송을 수행하지 않는다.

| 메서드 | 경로 | 상태 | 동작 |
| --- | --- | --- | --- |
| `GET` | `/health` (및 `/api/health`) | 구현 완료 | 서버 상태 확인 (`200 OK`) |
| `GET` | `/api/documents` | 구현 완료 | SQLite `documents` 목록 조회 |
| `POST` | `/api/documents` | 구현 완료 | 문서 저장 (`201 Created`, 본문 상한 1 MiB) |
| `DELETE` | `/api/documents/:id` | 구현 완료 | 문서 삭제 |
| `GET` | `/api/core` (및 `/api/core/status`) | 구현 완료 | `implementation` (`real`/`fake`), `connection` (`direct`/`simulated`), `ready` 조회 |
| `POST` | `/api/sharing` (및 `/api/core/generate`) | 구현 완료 | 호출자가 승인한 `facts` 배열로 주입된 `Core.generate()` 호출 (본문 상한 1 MiB) |
| `POST` | `/api/analysis` | 구현 완료 | 주입된 `Engine.analyze()`로 원자료를 결정적으로 파싱하고 근거(`evidence`)와 후보 제안(`proposals`)을 반환 (본문 상한 1.5 MiB, stateless) |
| `GET`/`PUT` | `/__demo`, `/api/demo/settings` | `fake-app` 전용 | 시연용 지연(`delayMs`)/실패 횟수(`failuresRemaining`)/고정 스크립트 제어 (실제 `app`에서는 `404`) |
| `GET` | `/__presentation`, `/assets/*.js`, `/presentation.css` | `fake-app` 전용 | CDP 6단계 자막/장면 타임라인/재생 제어 연출 화면 (실제 `app`에는 미포함) |

연출 화면의 스크립트와 스타일은 `vite build` 결과인 `packages/fake-app/dist/static`에서 서빙합니다.
화면 경로 `/__presentation`과 `/__demo`는 각각 `presentation.html`과 `index.html`로 넘기고, 번들은
해시가 붙은 `/assets/*.js`, 스타일은 `/presentation.css`입니다. 예전 고정 스크립트
`/__presentation.js`는 더 이상 제공하지 않으며(404), 서버가 정적 자산을 내보내는 경로만 바뀌었고
HTTP API 계약은 그대로입니다. 연출의 분석과 공개 선택은 브라우저 상태이고 실제 승인 API를 구현한
것으로 표시하지 않습니다.

### 코어 생성 요청 형식 (`POST /api/sharing` / `/api/core/generate`)

```json
{
  "purpose": "공급사 기술지원 문의",
  "recipient": "지정 가상 공급사",
  "facts": [
    {"id": "observation", "text": "첫 요청은 응답 대기 timeout을 관찰했습니다."},
    {"id": "uncertainty", "text": "서버 처리 완료와 중복 여부는 모릅니다."}
  ]
}
```

- `facts`는 호출자가 이번 목적/수신자에게 공개하기로 승인한 표현이다. 원자료 `sources`나 추가 키를 같이 보내면 `400 INVALID_CORE_INPUT`으로 거부한다.
- 성공 시 `document: { title, body }`와 `provenance: { implementation, connection, ready }`를 반환한다.
- 모델 설정 없음/호출 실패/검토 미통과는 `503 CORE_UNAVAILABLE`, 미구현 기능은 `CORE_NOT_IMPLEMENTED`, 취소는 `CORE_CANCELLED`로 반환하며 실제 앱에서 가짜 응답으로 대체하지 않는다 (`INV-14`).

---

## 2. 현행 구현된 엔진/라이브러리 계약 (`@safehandoff/core` / `core-interface`)

| 모듈 / 메서드 | 입력 계약 | 반환 계약 및 보장 |
| --- | --- | --- |
| `parseSources(sources)` | `SourceFile[]` (`.txt`, `.md`, `.csv`, `.json`) | UTF-8 바이트 오프셋, CSV 행/열, JSON Pointer 기반 불변 `Evidence[]` 생성 (`packages/core/src/evidence-parser.ts`) |
| `RealCore.analyze(req, {signal?})` | `AnalyzeRequest` (`task`, `sources` base64/SHA-256/included) | `{ evidence, proposals }` 반환 (`candidate_proposals.v1` 엄격 검증, 타 작업/미존재 `evidence_id` 거부, 분석 본문 transcript 미기록) |
| `TaskStore.analysis` / `runTaskAnalysis` | `replaceSources(id, rev, sources)`, `runTaskAnalysis(store, engine, id, rev)`, `addManual` | SQLite migration v2 기반 source/evidence/job snapshot 저장 및 현재 `revision`/job/source/skill CAS 대조 후 원자적 채택 |
| `composeFactPack(input)` | `ComposeFactPackInput` (`candidates`, `decisions`, `rules`, `scope`) | 승인된 `allow` 결정만 투영한 `FactPack`(`fact_pack.v1`) 생성 |
| `groundFacts(context, pack, now)` | `ReviewGroundingContext`, `FactPack`, 현재 시각 | 각 사실의 `fresh_decision` / `reused_rule` 바인딩 검증. 만료/철회/범위 불일치 시 모델 호출 전 차단 |
| `RealCore.write(factPack)` | `FactPack` | 원자료 없이 승인 사실만 사용한 `Draft`(`draft.v1` DocAST) 생성 |
| `RealCore.review(draft, pack, ctx)` | `Draft`, `FactPack`, `ReviewGroundingContext` | 결정적 Grounding + 필수 사실 누락 검사 + 모델 의미 검토(`review.v1`) |
| `RealCore.writeReviewed(pack, opts)` | `FactPack`, `{ grounding, now, signal }` | `groundFacts` -> `write` -> `review` -> `needs_changes` 시 고정 `reason_code`로 최대 1회 자동 수리 |
| `builtin-tools` 5종 | `ToolRequest` (`derive_series_v1`, `render_timeline_v1`, `make_config_example_v1`, `make_synthetic_inputs_v1`, `render_approved_excerpt_v1`) | `BigInt` `HALF_UP` 지수(`100/141/212`), 방향(`기준/증가/감소`), `[가림]` 바이트 치환, 6글자 합성 입력 생성 |
| `DockerReproRunner.reproduce(req)` | 고정 이미지 digest, 합성 입력 2종, `toyrecord` target pair | `--network=none`, `--read-only` 컨테이너 4회 실행 후 고정 oracle 판정 (`reproduced` 등) |

---

## 3. 연결 설정/Transcript/ToyRecord 스모크 계약

1. **모델 연결 환경 변수**:
   - `SAFEHANDOFF_LLM_BASE_URL`, `SAFEHANDOFF_LLM_MODEL`, `SAFEHANDOFF_LLM_API_KEY`를 설정 파일(`SAFEHANDOFF_CONFIG`, 기본 `config.json` / `config.example.json`)에 지정된 환경 변수 이름으로 읽는다.
   - 분석/작성/검토는 tool calling이 필요한 `submit` 결과 도구를 사용하며 `response_format`을 전송하지 않는다.
   - `provider.response_mode`는 도구 없는 공개 조건 해석/provider 확인 호출에만 적용한다. text는 프롬프트와 엄격한 응답 검증을 사용하고, json일 때만 JSON 응답 형식 필드를 전송한다.
2. **로컬 실행 Transcript (`transcript.v1`)**:
   - `SAFEHANDOFF_TRANSCRIPT_DIR` 설정 시 실행별 JSONL(`transcript-<run_id>.jsonl`)을 기록한다.
   - `SAFEHANDOFF_TRANSCRIPT_CONTENT=1`은 명시적 opt-in이며 원자료/API 키/리뷰어 내부 설명은 기록하지 않는다. 세부 이벤트 순서는 [에이전트 역할 계약](agent-workflow.md) 10을 따른다.
3. **ToyRecord 스킬 팩 스모크**:
   - `tools/oss-repro-smoke.mjs`는 `--catalog`, `--pack-version`, `--registration`을 받아 `FsSkillPackLoader.verify()`로 팩 지문(`manifest_sha256`, `pack_sha256`)과 컨테이너 이미지 digest를 대조한 뒤 실행한다. 세부 절차는 [도메인 확장 계약](extensions.md) 10 및 [시연 안내](demo.md) 2.3을 따른다.

---

## 4. 전체 제품 목표 `/api/v1` 워크플로우 HTTP 계약 (`F01-F10`)

`TaskStore`(`packages/server/src/task-store.ts`)의 상태/CAS 계층을 웹 화면 전체와 연결할 때 사용하는 목표 REST API 계약이다 (`contracts/core.schema.json` 기준).

- **공통 변경 헤더**: 모든 상태 변경 요청(`POST`, `PATCH`, `PUT`, `DELETE`)은 현재 작업 판본을 확인하는 `expected_revision` 필드와 중복 실행을 막는 `Idempotency-Key` 헤더를 요구한다.
- **동시성 및 무효화**: `expected_revision`이 현재 DB 판본과 다르면 `409 REVISION_CONFLICT`를 반환하고, 같은 `Idempotency-Key`에 다른 본문이 오면 `409 IDEMPOTENCY_CONFLICT`를 반환한다.

| 기능 | 메서드/경로 | 요청 핵심 필드 | 응답 및 상태 전이 |
| --- | --- | --- | --- |
| `F01` 작업/자료 | `POST /api/v1/tasks`, `POST /api/v1/tasks/{id}/sources` | `purpose_id`, `goal_variant`, `recipient_id`, `audience`, `expected_revision` | 불변 `source_versions` 저장, `revision + 1`, `needs_analysis` |
| `F02` 분석/수동 후보 | `POST /api/v1/tasks/{id}/jobs` (`kind=analyze`), `POST /api/v1/tasks/{id}/manual-candidates` | `expected_revision`, `statement`, `evidence_ids` | `candidate_sets` 생성, `needs_decisions` |
| `F03` 미리보기/결정 배치 | `POST /api/v1/tasks/{id}/disclosure-previews`, `POST /api/v1/tasks/{id}/decision-batches` | `expected_revision`, `Idempotency-Key`, `preview_id`, `approved_projection_sha256` | 원자적 결정 저장, 이전 결과 `stale`, `ready_to_generate` |
| `F04` 작성/검토/편집 | `POST /api/v1/tasks/{id}/jobs` (`kind=compose`/`review`), `PUT /api/v1/artifacts/{id}/edit` | `expected_revision`, `expected_document_hash`, `draft.v1` | `FactPack` 작성/검토, 통과 시 `ready_to_finalize` |
| `F05` 확정/내보내기 | `POST /api/v1/artifacts/{id}/finalize`, `GET /api/v1/exports/{id}/archive` | `expected_revision`, `expected_artifact_set_hash`, `Idempotency-Key` | 현재 결정/해시 재검증 후 저장된 동일 바이트 반환 (만료/철회 시 `409 EXPORT_INVALIDATED`) |
| `F06` 재사용 규칙 | `POST /api/v1/rules`, `POST /api/v1/tasks/{id}/rules/apply`, `POST /api/v1/rules/{id}/revoke` | `expected_revision`, `rule_refs`, `Idempotency-Key` | 6개 scope + `selector` 일치 시 새 자료에서 변환 재계산 (`exact_value` 저장 시 `422`) |
| `F07/F08` 확장/재현 | `GET /api/v1/catalog`, `POST /api/v1/tasks/{id}/jobs` (`kind=reproduce`) | `target_pair_id`, `synthetic_input_set_id`, `expected_revision` | 고정 digest 확인 후 4회 실행 결과 정형 투영 |
| `F09/F10` 이력/삭제/세션 | `GET /api/v1/tasks/{id}/events`, `DELETE /api/v1/tasks/{id}`, `POST /api/v1/auth/session` | `expected_revision`, `confirmation="DELETE"`, `acknowledge_saved_rules_retained=true` | 원자료/초안/이력 즉시 삭제 및 재사용 규칙 원작업 FK 해제 |

---

## 5. 인증된 task/공개 결정 API (단일 운영자 개발용)

기존 `/api/analysis`는 stateless로 유지한다. 아래 v1 경로는 실제 앱에서
`SAFEHANDOFF_WORKFLOW_ENABLED=1`로 켠 경우 활성화된다. 기존 WORKFLOW_TOKEN 설정도 활성화 입력으로 지원한다. 미설정/fake-app은
503 `WORKFLOW_API_DISABLED`다. 워크플로우 세션을 켜면 기존 `/api/documents`/`/api/sharing`/
`/api/analysis`도 **같은** 세션/CSRF/Host/Origin 검사를 거친다(`packages/server/src/app.ts`의
`GUARDED_PATHS`, `packages/app/src/main.ts`가 `createWorkflowHandler`와 `createApp`에 같은
`WorkflowSessions` 인스턴스를 공유해 한 쪽에서 연 세션이 다른 쪽에도 통한다). 세션을 켜지 않으면
세 경로는 이전처럼 그대로 열려 있다. 다중 사용자/LAN 운영 인증이나 외부 제출을 구현한 것이
아니며, `/health`/`/api/core`는 원자료나 모델 출력을 반환하지 않아 이 검사 대상이 아니다.

`SAFEHANDOFF_WORKFLOW_BROWSER_ORIGIN`은 브라우저의 정확한 origin(기본
`http://127.0.0.1:5173`), `SAFEHANDOFF_WORKFLOW_SERVER_ORIGIN`은 API origin(기본
`http://127.0.0.1:${PORT}`)이다. 둘 다 HTTP loopback만 지원한다. localhost와 127.0.0.1은
서로 다른 값이다. 클라이언트 프록시는 실제 API Host를 사용하고 브라우저 Origin/Cookie/
X-CSRF-Token/Idempotency-Key와 Set-Cookie를 전달한다. 임의 origin/와일드카드는 허용하지 않는다.

### 세션

- `POST /api/v1/session`: 정확한 브라우저 Origin, JSON `{ "token": "시작 시 터미널에 표시한 5분/1회용 토큰" }`.
  성공은 `{data:{csrf_token,expires_at,analysis_environment,capabilities}}`와 8시간 고정 HttpOnly/
  SameSite=Strict/Path=/ 쿠키다. 이 개발 API는 loopback HTTP만 허용하므로 Secure 쿠키를
  사용하지 않는다. 인증된 `GET /api/v1/session`은 같은 DTO를 반환한다. 서버 재시작 시 세션은 만료된다.
- 모든 v1 조회도 세션이 필요하다. 세션 없음/만료는 401 `AUTH_REQUIRED`, Host/Origin 거부와
  CSRF 실패는 403이다. GET은 Origin 생략이 가능하고, 쓰기는 정확한 Origin과 CSRF가 필수다.
- `analysis_environment`는 `{provider_origin:string|null,approval_status:
  "operator_confirmation_required",verified_at:null}`이다. provider origin은 실제 설정의
  환경 변수 이름으로 조회하며 경로/query/사용자명/비밀번호를 제거한다. 모델 키는 반환하지 않는다.
  주소 표시는 사내/로컬 승인이나 모델 연결 성공의 증거가 아니다. 운영자가 확인해야 한다.
- `capabilities`는 tasks/selected_fields/reusable_rules/artifacts/exports=true, approved_excerpt=false다.
  세션은 하나의 로컬 운영자 권한이며 task별 사용자 소유권을 구현한 것으로 해석하지 않는다.

### 요청/응답

성공은 `{data: ...}`, 오류는 `{error: "CODE"}`다. JSON 쓰기는 Content-Type이 필요하고
본문 상한은 1.5 MiB다. 세션 생성 외 모든 쓰기는 1~200자 Idempotency-Key를 요구한다.
같은 경로/키/본문 재전송은 최초 결과를 반환하고, 다른 본문은 409 `IDEMPOTENCY_CONFLICT`다.
본문 키 순서까지 동일하게 재전송한다. task 생성 외 쓰기는 양의 정수 expected_revision을 사용한다.
판본 불일치는 409 `REVISION_CONFLICT`이며 부분 저장하지 않는다. 키/결과는 SQLite에 영속한다.
원자료와 공개 projection을 담을 수 있는 task별 재전송 기록은 task 삭제와 함께 삭제된다.
생성 요청의 재전송 결과는 삭제 시 `{id,deleted:true}`로 바꿔 context를 남기지 않는다.

| 경로 | 본문 또는 응답 data |
| --- | --- |
| POST /api/v1/tasks | `{context:{purpose,recipient,goal_variant?,output_language?}}` -> 201 StoredTask |
| GET /api/v1/tasks/{id} | 현재 task 집계(아래 설명) |
| PUT /api/v1/tasks/{id}/sources | `{expected_revision,sources:SourceDocument[]}` -> StoredTask |
| POST /api/v1/tasks/{id}/jobs | `{expected_revision,kind:"analyze"}` -> 202 job 요약 |
| GET /api/v1/tasks/{id}/jobs/{job_id} | 분석 job 요약. 원자료 snapshot은 반환하지 않음 |
| POST /api/v1/tasks/{id}/jobs/{job_id}/cancel | `{expected_revision}` -> 202 `{cancel_requested:boolean,job_id}` |
| POST /api/v1/tasks/{id}/manual-candidates | `{expected_revision,candidate,evidence_ids? 또는 user_note?}` -> 201 StoredTask |
| GET /api/v1/tasks/{id}/candidates/{candidate_id}/fields | `{candidate_id,input_revision,source_version_id,fields:string[],reusable:false}` |
| POST /api/v1/tasks/{id}/disclosure-previews | `{expected_revision,candidate_id,representation}` -> DisclosurePreview |
| POST /api/v1/tasks/{id}/jobs | `{expected_revision,kind:"interpret_disclosure",arguments:{candidate_id,text}}` -> 202 조건 해석 job |
| GET /api/v1/jobs/{job_id} | 조건 해석 job. 현재 판본이 다르면 stale/result=null |
| POST /api/v1/tasks/{id}/decision-batches | `{expected_revision,accept_scope_reduction:boolean,operations:[...]}` -> StoredTask |
| POST /api/v1/tasks/{id}/decisions/{decision_id}/revoke | `{expected_revision}` -> StoredTask |
| DELETE /api/v1/tasks/{id} | `{expected_revision,confirmation:"DELETE",acknowledge_saved_rules_retained:true}` -> `{id,deleted:true}` |

StoredTask는 id/revision/phase/context/source_set_hash/skill_set_hash/current_candidate_set_id다.
집계는 여기에 sources/evidence/candidates/decisions/scope/intake와 현재 job/artifact 포인터를 추가한다.
sources는 메타데이터만 반환하고 raw_bytes는 되돌려주지 않는다. 원자료 바이트는 내부 snapshot에만 보관한다. candidates는 서버 id,
분석 local_key, origin(model/manual), selector=null, conflicts, required와 기존 Candidate 필드를
포함한다. 임시 local_key->영속 id 대응은 이 목록으로 확인한다. decisions는 candidate_id별 현재
결정 객체이며 representation/projection_sha256/revoked/expires_at을 포함한다. scope는 task ID와
purpose/recipient의 SHA-256/skill hash에 묶은 서버 내부 범위다. 카탈로그 Rule scope를 대신하지 않는다.
참고 task.v1 전체 필드를 보장하는 API로 해석하지 않는다.

SourceDocument 형식/hash/base64와 한도는 앞의 `/api/analysis`와 같다. sources 교체는 revision을
한 번 올리고 이전 후보/결정을 무효화한다. 분석 시작도 revision을 한 번 올리고, 완료 채택은
한 번 더 올린다. 분석 job은 id/task_id/revision/input_revision/kind/status/error_code를 반환한다.
상태는 running/succeeded/failed/cancelled/stale다. 등록한 원자료 snapshot으로만 Engine을 호출하고
브라우저의 AnalyzeResult는 받지 않는다. 모델 대기 중 DB 트랜잭션을 유지하지 않는다. 재분석/취소/
삭제/원자료 변경 뒤 늦은 응답은 후보나 허용 결정을 만들 수 없다. job 최대 동시 실행은 4개이며
초과는 429 `JOB_LIMIT`, 프로세스 재시작 후 미완료 job은 INTERRUPTED로 실패 처리한다.

수동 candidate는 kind/uncertainty/statement/relevance/purpose_relevance다. evidence_ids와
user_note 중 정확히 하나만 지정한다. user_note는 서버 소유 원자료/근거로 저장하며 모델 호출과
공개 결정을 만들지 않는다. 다른 task/현재 선택에서 제거한 source의 참조는 거부한다.

### 표현과 결정

- A: `{kind:"fact_summary",transform_id:"",parameters:{}}`. 현재 후보 문장을 그대로 미리보기한다.
  자동으로 구체 값이 제거됐다고 보장하지 않는다. 사람이 실제 표시 문장을 보고 승인한다.
- B: 단일 CSV의 한 숫자 열에 연결된 후보만 `series_direction_only.v1` derived_table을 지원한다.
  `series_index_base100.v1`은 parameters에 decimal_places(0~4)를 선택할 수 있다.
- C: `{kind:"selected_fields",transform_id:"select_fields.v1",parameters:{fields:[...]}}`.
  단일 CSV/JSON의 후보에 연결된 검증된 근거만 선택 가능하다. CSV는 논리 행 순서의 실제 셀,
  JSON은 정확한 JSON pointer(루트는 빈 문자열)를 사용한다. 혼합 소스/목록 밖 필드/중복 필드/
  빠진 CSV 셀을 거부한다. CSV 따옴표/개행과 JSON 문자열을 실제 값으로 복원하며 선택하지 않은
  필드 값은 projection에 포함하지 않는다. exact_value는 단일 CSV/JSON 근거 값만 지원한다.
- D: 조건과 후보 하나/task context만 disclosure 역할 모델에 보내 strict 검증한 제안을 반환한다.
  supported/ambiguous/unsupported는 승인 상태가 아니다. 지원 제안도 실제 미리보기 검증을 거쳐야
  한다. 해석 job은 미리보기/결정/Rule을 만들지 않고, 모델/retry/입력 예산은 기존 설정을 따른다.
- approved_excerpt/타임라인 표현과 미지원 job은 422로 거부한다. C/정확한 값/원문은 재사용할 수
  없으며 재사용 저장은 catalog scope와 파서 인증된 단일 CSV 숫자 열의 방향/지수 변환에만 허용한다.
  일반 요약 문장/selected_fields/exact_value/원문 저장은 422 RULE_NOT_REUSABLE로 거부한다.

미리보기는 서버가 계산한 projection을 불변 저장하고 현재 revision/source hash/context와 결합한다.
응답은 schema_version/preview_id/candidate_id/input_revision/representation/projection/
projection_sha256/raw_grants이며 여기서는 raw_grants=[]다. projection은 statement/columns/rows다.
최종 원문 예외 승인은 이번 구현에 없다.

operations의 allow는 candidate_id/disposition/representation/preview_id/projection_sha256와
save_reusable_rule(boolean)를 보낸다. true는 같은 트랜잭션에서 유효한 현재 결정으로 규칙을 저장한다. exclude/defer는 candidate_id/disposition만 보낸다.
expires_at은 선택 가능하며 과거 시각은 거부한다. 필수 후보 exclude에는 accept_scope_reduction=true가
필요하다. preview/representation/hash/source/scope/revision/후보 참조 중 하나라도 다르면 전체 배치를
거부한다. 적용은 revision을 한 번 올린다. 철회도 판본을 올리고 과거 허용으로 복귀하지 않는다.

404 TASK_NOT_FOUND/ANALYSIS_NOT_FOUND와 404 ENDPOINT_NOT_FOUND, 비활성 API의 503을 구분한다.
미지원 기능은 422다. 서버 API 제공과 task 생성/저장/C 필드 선택/초안/확정/Rule 관리 화면 연결은 구분한다. 후속 UI 접점은 [요청 현황](ui-api-requests.md)에 적는다.


## 초안/파일/규칙/이력 API

`SAFEHANDOFF_WORKFLOW_ENABLED=1`은 암호학적 시작 토큰을 터미널에 한 번 표시한다.
토큰은 프로세스 시작부터 5분/1회만 유효하고 DB/transcript/응답에 저장하지 않는다.
기존 SAFEHANDOFF_WORKFLOW_TOKEN(32자 이상)은 같은 수명/사용 제한을 따르며 터미널에 재표시하지 않는다.
DELETE /api/v1/session은 Origin/CSRF/멱등 키를 확인해 로그아웃하고 쿠키를 지운다.
세션은 갱신 없는 8시간 고정이며 재시작 시 폐기한다. app/client의 기본 bind는 127.0.0.1이다.

SAFEHANDOFF_WORKFLOW_CATALOG는 운영자 JSON 경로다. 형식은 projects/recipients 배열이며
각 항목은 `{id,display_name}`이다. 생략 시 두 목록은 빈 배열이다. 가상 예제는
`fixtures/workflow/catalog.json`이며 실제 운영 설정으로 자동 채택하지 않는다.
목적은 oss_issue/vendor_support/operations_advice, goal은 default/observations_only/
ask_for_diagnostics/reproduction_evidence다. 연결되지 않은 확장 팩을 설치 상태로 표시하지 않는다.

모든 경로는 기존 세션/쓰기 CSRF/Origin/Host/멱등 키 규칙을 따른다. 성공 data envelope를 사용한다.

| 경로 | 입력과 결과 |
| --- | --- |
| GET /api/v1/catalog | 프로젝트/목적/수신자/goal/양식/활성 확장(현재 빈 배열)/실제 한도 |
| GET /api/v1/runtime | core 모드/model_id/app_version/확장/검사기/재현 설정/debug 정책. URL/키/토큰/내부 경로 제외 |
| GET /api/v1/tasks?cursor=... | 최근 수정순 30개, tasks와 next_cursor. 원자료/모델 응답 없음 |
| POST /api/v1/tasks | `{intake:{internal_title,project_id,purpose_id,recipient_id,audience,skill_ids,goal_variant?,output_language?}}` |
| GET /api/v1/tasks/{id}/sources | 등록 판본 메타데이터/byte_size/선택 여부. raw_bytes 없음 |
| DELETE /api/v1/tasks/{id}/sources/{source_id} | `{expected_revision}`. logical source_id 선택 해제/후보/결정 무효화 |
| GET /api/v1/tasks/{id}/events?after=seq | 시간순 seq/revision/kind/created_at. duration_ms/usage는 미측정(null) |
| GET /api/v1/tasks/{id}/events (Accept: text/event-stream) | Last-Event-ID 이후 재생과 새 이벤트. 세션 만료/종료 시 닫음 |
| POST /api/v1/tasks/{id}/jobs | kind=compose, `{expected_revision,kind,arguments?:{provisional?:boolean}}` |
| POST /api/v1/tasks/{id}/jobs | kind=review, arguments는 `{artifact_id,expected_artifact_set_hash}` |
| GET /api/v1/jobs/{id} | 분석/조건 해석/초안/검토 job의 kind/status/input_revision/artifact_id/고정 오류 코드 |
| GET /api/v1/artifacts/{id} | DocAST/검토/파일 메타데이터/hash/현재 여부. 내부 승인팩/grounding은 반환하지 않음 |
| GET /api/v1/tasks/{id}/bundle | 가장 최근 artifact와 실제 파일 목록. 과거 판본은 is_current=false |
| GET /api/v1/artifacts/{id}/files/{path} | 내부 확인용 실제 UTF-8 파일 바이트. 확정 다운로드 권한과 별개 |
| PUT /api/v1/artifacts/{id}/edit | `{expected_revision,expected_document_hash,draft}` -> 새 revision/artifact, 검토 무효 |
| POST /api/v1/artifacts/{id}/human-review | `{expected_revision,target_hash,checklist,fallback_reason}` -> 새 revision/artifact |
| POST /api/v1/tasks/{id}/finalize | `{expected_revision,artifact_id,expected_artifact_set_hash,confirmed:true}` -> 불변 export |
| GET /api/v1/exports/{id}/files/{path} | 확정한 동일 바이트, Content-Disposition: attachment |
| GET /api/v1/exports/{id}/archive | 저장된 동일 ZIP, archive_sha256으로 확인 가능 |
| GET /api/v1/rules | logical ID별 최신 판본/scope/selector/표현/만료/철회 |
| POST /api/v1/rules | `{task_id,expected_revision,decision_id}`. 현재 유효한 allow에서 별도 규칙 저장 |
| POST /api/v1/rules/{id}/versions | `{expected_rule_version,representation,expires_at}`. 새 불변 판본 |
| POST /api/v1/rules/{id}/revoke | `{expected_rule_version}`. 전 판본 철회/영향 task revision 증가 |
| POST /api/v1/tasks/{id}/rules/apply | `{expected_revision,rule_refs:[{id,version}]}`. 전부 성공 또는 전부 거부 |

intake는 catalog 밖 ID/등록되지 않은 skill_ids를 거부한다. 현재 skill_ids는 빈 배열만 받는다.
기존 context 기반 작업 생성도 유지하되, catalog scope가 없는 작업은 재사용 규칙을 저장할 수 없다.
PUT sources는 included=false도 검증해 보관하며 선택에서는 제외한다. 분석은 included=true만 읽는다.
한도는 100개/개당 256 KiB/합계 1 MiB/근거 100개이며 catalog와 코드가 같은 값을 쓴다.

초안 시작과 채택, 편집/검토/사람 검토/확정은 각각 새 revision을 만든다. 새 입력 뒤 늦은 결과는
현재 초안을 덮지 않는다. 조회 phase는 needs_analysis/needs_decisions/processing/needs_attention/
ready_to_generate/ready_to_finalize/finalized이고 current_job_id/current_artifact_id를 제공한다.
writer는 서버의 현재 유효 결정으로 구성한 FactPack만 받으며 원자료/원래 파일명/내부 제목은 받지 않는다.
작성 검토와 실제 렌더 파일 검토는 같은 모델 호출/repair 예산에 묶인다. retry/수정은 기존 config를 따른다.

파일은 support-request.md, observations-NNN.csv, manifest.json만 생성한다. HTML/외부 이미지/링크를
실행하지 않고 CSV 수식 문자열을 보호한다. manifest는 payload 상대경로/크기/hash만 포함한다.
artifact_set_hash는 manifest까지 포함한 정렬 메타데이터의 JSON hash다. ZIP은 고정 순서/
1980-01-01 시각/일반 파일 0644 권한이며 경로 탈출/중복 이름/심볼릭 링크 메타데이터를 거부한다.
확정/다운로드는 현재 revision/결정/규칙 활성/미보류/필수 fact/검토 대상 hash/파일 integrity를 재검사한다.
다운로드는 저장 바이트만 반환하며 renderer나 모델을 다시 실행하지 않는다. 무효화는 409 EXPORT_INVALIDATED다.
확정 뒤 편집도 새 revision과 재검토가 필요하다. reproduction_evidence 목표는 재현 증거 연결 전까지 확정 불가다.

사람 검토 checklist는 reviewed_all_files/approved_facts_only/uncertainty_preserved를 모두 true로 보낸다.
대상은 현재 artifact_set_hash다. 모델 timeout/unavailable의 의미 검토 대체만 허용하고, hard gate나
needs_changes/needs_decision을 우회할 수 없다. 주석/원문 슬롯/등록 asset/별도 맥락 검사 예외는 이번 지원에 없다.

규칙은 값이나 과거 문장이 아닌 source_slot/파서 인증 숫자 CSV 열 selector/변환만 저장한다.
방향/지수 변환만 재사용하며 새 바이트로 재계산한다. scope와 goal을 정확히 대조하고 최신 활성 판본만
새 적용에 쓴다. 과거 판본 fallback은 없다. 서로 다른 결과가 충돌하면 자동 허용하지 않고 이력에 남긴다.
선택/후보/파생 결정은 같은 트랜잭션에 채택하며, 명시 적용 충돌도 전체 거부한다. 전 판본 철회와
판본별 만료는 확정/다운로드에도 적용한다. 작업을 삭제해도 값/원문 없는 저장 규칙은 남는다.

취소 응답은 202 cancel_requested이며 worker 종료 전에는 완료로 표시하지 않는다. task 삭제는
confirmation=DELETE와 acknowledge_saved_rules_retained=true를 요구하고 실행 종료를 기다린 뒤 삭제한다.
클라이언트 프록시는 query/Last-Event-ID/스트림과 바이너리 바이트를 보존한다.

모델 통신은 Vercel AI SDK의 OpenAI 호환 provider를 사용한다. SDK 자체 재시도는 비활성화하고
기존 Engine 호출 예산, 직접 전송의 리다이렉트 금지, 크기 제한과 타임아웃을 유지한다.

분석/작성/검토는 `@typia/vercel`의 `submit` 도구와 typia 런타임 검증을 사용한다. 서버 HTTP/DB
계약은 유지한다. 도구는 결과 객체를 반환할 뿐 외부 실행이나 승인 결정을 수행하지 않는다.
스키마의 타입 검증 뒤 기존 Engine의 현재 근거/참조 검증을 그대로 적용한다. 중복 JSON 키와
알 수 없는 속성은 허용하지 않는다. 한 응답에 도구 호출은 정확히 하나여야 하며, 일반 텍스트만
반환하거나 여러 도구를 호출한 응답은 MODEL_INVALID_RESPONSE다. 도구 이름 오류는 복구 대상이다.

AI SDK의 tool-call repair는 구문/타입을 로컬에서 복구할 수 있으면 추가 호출 없이 검증한다.
모델 재호출이 필요하면 같은 역할의 입력과 검증 피드백만 전달한다. 모든 추가 HTTP 호출은
Engine의 단계별 시도 수와 전체 run 예산을 전송 전에 차감한다. SDK의 자동 재시도와 다단계
실행은 사용하지 않는다. 타임아웃/취소/동시성 제한은 복구 호출에도 적용하며, 응답 usage는
복구 호출을 포함한 합계다. 측정값이 없는 토큰 필드는 null이다. 인증 키/운영 설정은 추가하지 않았다.
