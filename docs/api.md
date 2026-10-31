# HTTP·서비스·DTO 계약

현재 웹·엔진 분리 시험 경로와 실제 구현 범위는 [독립 실행 계약](separated-runtime.md)을 따른다. 기존 전체 기능 계약과 새 시험 경로의 구현 완료를 구분한다.

버전: `/api/v1` · 상태: 구현할 계약. 이 문서는 서버/화면 담당자가 함께 사용하는 경계다. 공통 enum과 핵심 JSON Schema는 [domain-contract](../contracts/domain-contract.json), [core.schema](../contracts/core.schema.json)에 있다. JSON Schema로 표현하지 않은 소속·승인·hash·상태 검사는 반드시 서비스 계층에서 수행한다.

## 1. 공통 규칙

- JSON UTF-8, 시각은 UTC RFC 3339, 알 수 없는 키·중복 키·타입 불일치·후행 JSON 거부. 숫자는 정수 또는 명시적 decimal string이다.
- 모든 업무 요청은 로컬 세션이 필요하다. 상태 변경은 Host·Origin·CSRF 검사와 `Idempotency-Key`가 필요하다. 일회 인증 교환과 logout은 아래 별도 계약을 따른다.
- 작업 입력을 바꾸는 요청은 `expected_revision`; 규칙을 바꾸는 요청은 `expected_rule_version`; 편집/검토/확정은 추가로 대상 hash를 검사한다.
- method+path+key가 같고 요청 hash도 같으면 저장된 응답을 반환한다. 다른 본문이면 409 IDEMPOTENCY_CONFLICT. 캐시 반환 전에도 인증·CSRF를 검사하며 과거 응답이 현재 다운로드 권한을 부활시키지 않는다.
- 멱등 기록은 기본24시간이다. 만료 후 같은 요청이 들어오면 새 요청으로 현재 revision·상태를 검사한다. final export에는 유일 제약도 둔다.
- 비동기 요청 접수는202, 생성201, 일반 성공200, 내용 없는 삭제204. 성공은 `{"data":...}`, 실패는 `{"error":...}`다. 파일·SSE·204는 예외다.
- 모든 참조의 task 소속을 검사한다. 존재하지 않거나 다른 작업에 속한 ID는404 OBJECT_NOT_FOUND. ID를 아는 것만으로 다른 작업의 승인/파일을 결합하지 못한다.

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "선택이 변경되었습니다. 최신 상태를 확인해 주세요.",
    "retryable": false,
    "current_revision": 13,
    "details": {"action": "reload_task"}
  }
}
```

에러에 원문·API key·모델 원응답·서버 path를 담지 않는다. `current_revision`은 인증된 해당 작업에 한해 반환한다. 네트워크 수신 성공 이후 모델 실패는 job.error_code로 기록하며 최초202를 수정하지 않는다.

## 2. 경로 목록

이 표의 경로 앞에 `/api/v1`을 붙인다. 상대 경로 텍스트는 파일 링크가 아니라 API 표기다.

### 2.1 접속·카탈로그

| Method/path | 서비스 함수 | 요청 | 반환 |
| --- | --- | --- | --- |
| GET /health | HealthService.Liveness | 없음 | 비인증은 `{status:"ok"}` 수준. DB내용/endpoint/모델명 없음 |
| POST /auth/session | AuthService.ExchangeToken | `{bootstrap_token}` | 일회 교환, session cookie와 csrf_token. 아래§3 |
| DELETE /auth/session | AuthService.Logout | 세션·CSRF |204, 세션 폐기. 재호출도204 |
| GET /catalog | CatalogService.GetCatalog | 없음 | 프로젝트·목적/goal·수신자·양식·등록팩·변환·필수need 목록 |
| GET /runtime | RuntimeService.GetStatus | 없음 | mode, 설정됨 여부, worker/runner 상태. 자격 증명·전체 URL 비공개 |
| POST /provider/check | ProviderService.Check | `{}` + 멱등키 |202 비민감 점검 job. mode는 서버 설정 |

첫 PoC 카탈로그는 검증된 로컬 설정이다. project/recipient 생성 UI나 POST /catalog 하위 API는 만들지 않는다. 설정 담당자가 불변 ID로 등록하고 재시작한다. 변경된 팩 digest는 새 판본으로 취급한다.

### 2.2 작업과 자료

| Method/path | 서비스 함수 | 요청 핵심 | 반환 |
| --- | --- | --- | --- |
| POST /tasks | TaskService.CreateTask | CreateTask |201 TaskView(revision=1) |
| GET /tasks | TaskService.ListTasks | cursor?,limit?(기본20,최대100),phase? | summaries,next_cursor |
| GET /tasks/{id} | TaskService.GetTask | 없음 | TaskView |
| PATCH /tasks/{id} | TaskService.UpdateTask | expected_revision + 변경한 metadata | TaskView, invalidated_artifact_ids |
| DELETE /tasks/{id} | TaskService.DeleteTask | expected_revision,confirmation="DELETE",acknowledge_saved_rules_retained=true |204, 삭제 영수증 |
| POST /tasks/{id}/source-batches | SourceService.AddSourceBatch | multipart meta + 파일 | SourceBatchResult |
| DELETE /tasks/{id}/sources/{source_id} | SourceService.ExcludeSource | expected_revision | TaskView; 바이트 삭제가 아닌 입력 제외 |
| GET /tasks/{id}/sources/{source_version_id} | SourceService.GetSource | 없음 | 내부 source metadata+내용, 판본/포함 여부 |
| GET /tasks/{id}/evidence/{evidence_id} | EvidenceService.GetEvidence | 없음 | 내부 근거 위치·판본·텍스트 |

`internal_title` 최대120문자, project/recipient/skill ID는 카탈로그에 있어야 한다. source display_name은 최대160문자이고 내부 표시용이다. 목적·goal·audience 조합은 domain-contract 및 수신자 카탈로그와 일치해야 한다. 빈 문자열·공백만 있는 제목/목적 메모는 거부한다. `output_language`는 ko/en이다.

### 2.3 비동기 작업·후보·공개 선택

| Method/path | 서비스 함수 | 요청 핵심 | 반환 |
| --- | --- | --- | --- |
| POST /tasks/{id}/jobs | JobService.Start | kind,expected_revision,arguments |202 JobView + current_revision |
| GET /jobs/{job_id} | JobService.GetJob | 없음 | status,stage,timing,result_ref,error_code |
| POST /jobs/{job_id}/cancel | JobService.Cancel | expected_revision | 취소 요청 결과. 완료 보장과 구분 |
| GET /tasks/{id}/candidates | AnalysisService.ListCandidates | 없음 | 현재 candidate_set, candidates, decisions, unmet_needs |
| POST /tasks/{id}/manual-candidates | AnalysisService.AddManualCandidate | ManualCandidateInput | 새 revision·set·후보·무효화 목록 |
| POST /tasks/{id}/disclosure-previews | DisclosureService.CreatePreview | PreviewInput | 실제 projection·해시·범위 설명 |
| POST /tasks/{id}/decision-batches | DisclosureService.ApplyDecisionBatch | DecisionBatch | 새 revision·결정 ID·다음 phase |
| POST /tasks/{id}/decisions/{decision_id}/revoke | DisclosureService.RevokeDecision | expected_revision | 새 revision, 영향 결과 |
| POST /tasks/{id}/rules/apply | RuleService.ApplyToTask | expected_revision,rule_refs[] | 새 revision·파생 결정·충돌/적용 불가 항목 |

### 2.4 저장 기준

| Method/path | 서비스 함수 | 요청 핵심 | 반환 |
| --- | --- | --- | --- |
| GET /rules | RuleService.ListRules | cursor?,limit?,status? | 최신/이력 판본과 scope·표현·만료·철회 |
| POST /rules | RuleService.SaveRule | task_id,expected_revision,decision_id,expires_at |201 rule ID/version |
| POST /rules/{id}/versions | RuleService.CreateVersion | expected_rule_version,task_id,expected_revision,decision_id,expires_at |201 새 불변 판본 |
| POST /rules/{id}/revoke | RuleService.Revoke | expected_rule_version | 해당 logical ID의 모든 판본 철회, 영향 task 목록 |

새 규칙은 현재 유효한 reusable 결정에서 서버가 scope/selector/transform을 추출한다. 임의 scope를 클라이언트가 보내 권한을 넓히지 못한다. 새 판본도 새 유효 결정에서 만든다. 첫 PoC 철회는 logical rule의 모든 판본에 적용한다. 만료는 판본별이다. 최신판본이 철회/만료되면 과거판본을 새 작업에 자동 적용하지 않는다. 이미 old version을 쓴 결정은 그 판본의 유효성으로 검사한다.

독립 POST /rules는 기존 출력 내용을 바꾸지 않으므로 source task revision을 올리지 않는다. 반면 decision-batch의 save_rule는 선택 변경과 같은 원자적 commit에 포함된다. `rules/apply`는 현재 작업 선택을 바꾸므로 revision을 올린다. 새 분석의 자동 matching은 분석 채택 트랜잭션에서 같은 revision에 기록한다.

### 2.5 초안·검토·확정·파일

| Method/path | 서비스 함수 | 요청 핵심 | 반환 |
| --- | --- | --- | --- |
| GET /artifacts/{artifact_id} | ArtifactService.GetArtifact | 없음 | DocAST, 파일목록, hash, 검사/검토/재현 상태 |
| GET /artifacts/{artifact_id}/files/{file_id}/preview | ArtifactService.PreviewFile | 없음 | 실제 후보 bytes의 안전한 내부 보기. stale 표시 |
| PUT /artifacts/{artifact_id}/edit | CompositionService.Edit | expected_revision,expected_document_hash,document | 새 revision·artifact·재검토 필요 |
| POST /artifacts/{artifact_id}/human-review | ReviewService.RecordHumanReview | HumanReviewInput | 현재 hash의 mode=human 검토 기록 |
| POST /artifacts/{artifact_id}/finalize | ExportService.Finalize | expected_revision,expected_artifact_set_hash,confirm=true | export ID·파일목록·archive hash |
| GET /exports/{export_id}/files/{file_id} | ExportService.GetFile | 없음 | 현재 유효한 확정 파일의 저장 bytes |
| GET /exports/{export_id}/archive | ExportService.GetArchive | 없음 | 현재 유효한 확정 ZIP bytes |
| GET /tasks/{id}/events | EventService.StreamTaskEvents | SSE, Last-Event-ID? | 상태 이벤트 또는 reset 안내 |

공식 복사 버튼도 ExportService.GetFile의 확정 본문을 UTF-8로 decode해 Clipboard API에 전달한다. preview의 innerText를 복사하지 않는다. 서버 반환은 같은 저장 bytes이며 클립보드/붙여넣기 앱의 줄바꿈 정규화까지 보장하지 않는다. Clipboard 실패는 성공 표시 없이 파일 저장을 안내한다.

## 3. 로컬 인증

접속 주소는 server.listen과 구분한다. 기본 loopback 외에 명시한 wildcard/서버 IP 바인딩을 지원하며 server.allowed_hosts는 추가로 허용할 브라우저 호스트:포트 목록이다. Host는 허용 목록에 있어야 하고 Origin은 같은 요청 Host와 일치해야 한다. 임의 도메인·다른 Origin·CSRF 없는 변경 요청을 허용하지 않는다.

앱을 시작한 OS 사용자에게만 256비트 일회 토큰을 터미널로 제시한다. 유효시간5분이다. 첫 PoC는 토큰을 URL에 넣지 않고 사용자가 로컬 접속 화면에 직접 입력한다. UI-10은 잘못된 토큰·만료·재사용을 공통 안전 문구로 안내한다. 새 토큰이 필요하면 앱을 재시작한다. 이때 queued/running 작업은 INTERRUPTED로 정리되고 저장 데이터는 유지된다. query/access log에 토큰을 남기지 않는다.

교환은 허용 Host/Origin에서만 가능하다. 8시간 세션 cookie를 HttpOnly·SameSite=Strict·Path=/로 발급한다. TLS 사용 시 Secure를 붙인다. 첫 PoC loopback HTTP에서는 Secure cookie를 전제로 인증을 깨뜨리지 않고 로컬 실행 경계를 명시한다. 외부 CORS는 허용하지 않는다. 인증 후 모든 mutation은 session별 CSRF token을 검사한다. 세션이 만료되거나 앱이 재시작하면 새 접속이 필요하며 작업 데이터는 유지된다.

Auth 교환은 token 자체가 일회성이며 일반 멱등 캐시를 사용하지 않는다. 교환 응답을 잃었으면 새 토큰을 발급한다. logout은 세션 소유자 동작이고 CSRF를 검사하며 같은 세션의 반복 폐기는204다.

## 4. 핵심 DTO

### 4.1 작업

```json
{
  "internal_title": "가상 공급사 문의",
  "project_id": "project_demo",
  "purpose_id": "vendor_support",
  "goal_variant": "default",
  "recipient_id": "vendor_lab",
  "audience": "named_external",
  "output_language": "ko",
  "skill_ids": ["vendorstore-support"]
}
```

TaskView: id, metadata(위 필드), revision, phase, provider_mode, current_job_id/current_candidate_set_id/current_artifact_id, reproduction 상태, `allowed_actions[]`, `blocking_reasons[]`, timestamps. `allowed_actions`는 UI 편의 정보이며 서버 재검사를 대신하지 않는다. 목록 summary에는 원문·projection·trace body를 넣지 않는다.

PATCH는 위 metadata의 변경 필드만 받는다. 빈 patch는422다. internal_title만 바꿔도 첫 PoC는 revision+1/stale를 적용한다. 목적/goal/source/팩 변경은 재분석, 상대/공개범위만 변경은 재결정, 언어/제목만 변경은 기존 결정을 재검증하고 재작성한다. 메타데이터 변경으로 확인하지 않은 공개 정보를 자동 넣지 않는다.

### 4.2 입력 batch

multipart `meta`는 다음 객체이고 파일 part 이름은 client_key다.

```json
{
  "expected_revision": 1,
  "items": [
    {"client_key":"file_1","display_name":"request-summary.csv","format":"csv","source_slot":"request_summary","replace_source_id":null}
  ]
}
```

items 1–10, client_key 유일, file part 정확히 일치, replace 대상은 현재 작업에 포함된 source다. 파싱/크기 검사 후 전체를 한 번에 commit한다. SourceBatchResult는 current_revision, source_versions, invalidated_artifact_ids, phase다. `requests_v1`의 observed_at는 UTC 시각 문자열, count는 0이상 9007199254740991 이하의 정수다. 지수처럼 범위를 넘을 수 있는 계산 결과는 typed decimal string으로 전달해 UI 정밀도 손실을 피한다. 실제 단위는 별도 notes이며 자동 공개되지 않는다.

### 4.3 job arguments

| kind | arguments | 허용 시점 |
| --- | --- | --- |
| analyze | `{}` | source 존재. 재분석이면 새 revision; 첫 분석/실패 재시도는 입력 불변이면 같은 revision |
| interpret_condition | `{candidate_id,user_text}` | 현재 후보, user_text 1–2000자. proposal만 반환 |
| compose | `{provisional:boolean}` | 현재 승인 정보. provisional=false는 작성 전 필수 선택 해소 |
| review | `{artifact_id,target_kind,target_hash}` | document 또는 bundle의 현재 hash |
| reproduce | `{target_pair_id,synthetic_input_set_id,oracle_id}` | 현재 허용된 등록 target/입력/결과 schema. 아직 없는 reproduction_result는 선행조건 아님 |

provider_check는 전용 API만 사용한다. task jobs로 호출하지 않는다. 같은 task에 active job이 있으면409 JOB_ALREADY_RUNNING이며 취소 또는 선택 변경으로 무효화 후 새 job을 요청한다. 여러 task는 전역 모델 큐에 들어갈 수 있다.

JobView는 id, task_id, input_revision, kind, mode, status, stage, cancel_requested, started_at/finished_at, result_ref, error_code다. arguments에 받은 ID가 등록되어도 현재 task 허용과 digest를 서버에서 다시 확인한다. model output의 shell/argv/path는 받지 않는다.

### 4.4 수동 후보

ManualCandidateInput: expected_revision, statement(1–8192 bytes), kind, uncertainty, relevance, need_keys[], 그리고 evidence_ids[] 또는 user_note 중 하나. user_note는 `{text,display_name}`이며 source 한도에 포함한다. 두 근거 경로를 동시에 받지 않는다.

같은 commit에서 필요한 source/evidence, 새 candidate_set과 fresh 후보 IDs, revision+1, 과거 결과 무효화를 만든다. 기존 유효 후보 내용은 새 집합에 복제하고 이전 결정을 자동 이전하지 않는다. 이전 선택을 참고로 보여주며 공개 선택을 다시 받는다. 수동 복구에는 모델 호출이 필요 없다.

### 4.5 미리보기

```json
{
  "expected_revision": 8,
  "candidate_id": "cand_volume",
  "representation": {"kind":"derived_table","transform_id":"series_direction_only.v1","parameters":{}}
}
```

응답: preview_id, input_revision, candidate_id, representation, projection, projection_sha256, disclosure_summary, reusable, warnings. projection은 `kind:text|table|excerpt|asset`별 실제 내용이다. source/scope/grant는 서버 내부 binding에 저장하고 클라이언트에서 재전송받아 권한으로 쓰지 않는다.

직접 입력의 지원 proposal도 이 API로 재계산한다. registered extension 선택에 한해 optional `extension_option_id`를 받는다. 서버 registry가 현재 candidate/팩에 연결된 generated example 또는 tool_result_schema의 미리보기·허용 범위를 만든다. 임의 tool ID나 JSON schema를 클라이언트가 등록하지 못한다. 첫 합성 입력 옵션은 길이6으로 고정하고 서버가 생성한 seed를 preview binding에 저장한다. 승인 시 재계산은 같은 seed를 사용한다. 새 예제를 원하면 새 preview를 생성하며 실제 생성 문자열·특성을 다시 확인한다.

`approved_excerpt.parameters`는 source_version_id, start,end,hidden_ranges다. 모든 좌표는 **원자료 기준 절대 UTF-8 byte 범위**다. hidden range는 발췌 범위에 완전히 포함되고 정렬·비중첩이며 각 경계가 문자 경계여야 한다. 대체 bytes는 고정 `[가림]`이다. 잘못된 범위를 정렬·보정해 승인하지 않고422로 돌려준다. 실제 렌더링 bytes를 보고 그 해시에 승인한다.

### 4.6 결정 batch

```json
{
  "expected_revision": 8,
  "items": [
    {"candidate_id":"cand_volume","disposition":"allow","preview_id":"preview_direction","approved_projection_sha256":"<실제 64자리 sha256>","expires_at":null,"save_rule":true},
    {"candidate_id":"cand_customer","disposition":"exclude"}
  ]
}
```

예시 hash 표시는 설명용이며 실제 요청은 hex64다. 같은 candidate의 항목을 중복 넣으면422. allow는 현재 preview와 hash 필수, exclude/defer는 preview·grant를 받지 않는다. 저장 전에 모든 preview를 다시 계산한다. 하나라도 실패하면 revision/결정/규칙 모두 변하지 않는다. 정확값·원문·C에 save_rule=true이면422 RULE_NOT_REUSABLE이며 사용자가 선택을 수정하게 한다.

성공: current_revision, phase, applied_decision_ids, created_rule_refs, invalidated_artifact_ids, unmet_needs. 원문/정확값 grant는 preview의 서버 binding으로 구성한다. 사용자 임의 문장은 먼저 수동 후보/근거와 미리보기를 거친다.

### 4.7 규칙 적용

`rule_refs=[{id,version}]`, 현재 expected_revision을 받는다. 새 자료의 검증된 selector에 재계산한다. 모든 참조의 유효성과 scope를 확인하고 conflict가 있으면 아무 결정도 적용하지 않고422 RULE_CONFLICT로 질문을 만든다. 유효한 적용은 새 decisions와 revision을 만든다. saved rule의 opaque IDs는 공개 출력에 들어가지 않는다.

### 4.8 직접 편집·사람 검토·확정

편집 input은 expected_revision, expected_document_hash, document(draft.v1)다. 클라이언트가 block_id를 새 권한으로 쓰지 못한다. 앱이 새 block ID/판본을 만들고 의미 검토가 필요한 상태로 둔다. approved slot의 데이터 직접 수정은 F03의 새 미리보기로 연결한다.

HumanReviewInput:

```json
{
  "expected_revision": 12,
  "target_kind": "bundle",
  "target_hash": "<실제 64자리 sha256>",
  "checklist": {"approved_scope_checked":true,"required_facts_checked":true,"uncertainty_checked":true,"all_files_checked":true},
  "fallback_reason": "MODEL_REVIEW_UNAVAILABLE"
}
```

문서 단계의 target_kind=document는 document_hash, bundle은 artifact_set_hash다. fallback_reason은 MODEL_REVIEW_UNAVAILABLE, MODEL_REVIEW_INCONCLUSIVE, HUMAN_REQUESTED 중 하나다. 모델이 원문 승인 누락을 지적한 것을 확인 없이 ‘의미 검토 불가’로 바꾸는 우회는 허용하지 않는다. 의미 지적은 사람이 현재 결과를 직접 검토해 해소할 수 있으나 새 공개 허용이 필요하면 F03으로 돌아간다.

FinalizeInput: expected_revision, expected_artifact_set_hash, confirm=true. artifact가 현재 ready인지, 최종 bundle review와 hard gate, 모든 보안 finding 해소, goal 완료를 확인한다. findings의 severity는 UI 우선순위이며 낮은 severity라도 미해결 보안 finding은 허용하지 않는다. 비보안 가이드는 별도 event로 표시한다.

## 5. 출력·SSE·캐시

파일은 안전한 Content-Disposition, nosniff, Cache-Control:no-store로 응답한다. 원문과 내부 미리보기는 텍스트로 render하고 raw HTML을 실행하지 않는다. Markdown의 링크 preview·원격 이미지 자동 fetch는 없다. 표의 문자열 수식 처리 후의 실제 출력 셀을 보여준다.

SSE event ID는 작업별 양수 seq다. type은 job.started, job.progress, decision.required, artifact.updated, review.completed, task.invalidated, job.failed, job.cancelled, export.finalized, rule.applied다. payload는 task_id,revision,job_id,object_id,stage,state 같은 상태 데이터만 포함한다.

중복/역순 이벤트는 seq/revision으로 무시한다. Last-Event-ID가 재생 범위 밖이면 reset 이벤트 후 현재 TaskView를 재조회한다. SSE 끊김은 job 취소가 아니다. 페이지 새로고침은 서버 저장 상태로 복원한다. 삭제 작업의 stream은 종료되며 GET task는404다.

## 6. 오류와 복구 표

| HTTP/code | 발생 조건 | 화면의 다음 행동 |
| --- | --- | --- |
|401 AUTH_REQUIRED / SESSION_EXPIRED | 세션 없음/만료 | 로컬 다시 접속, 저장 작업 유지 |
|403 ORIGIN_REJECTED / CSRF_INVALID | 로컬 요청 검증 실패 | 정상 앱 주소에서 다시 열기 |
|404 OBJECT_NOT_FOUND | 대상 없음/다른 task 소속 | 현재 작업 새로고침 |
|409 REVISION_CONFLICT / TARGET_HASH_MISMATCH | 다른 탭/선택/파일 변경 | 최신 내용 확인·다시 적용 |
|409 IDEMPOTENCY_CONFLICT | 같은 키의 다른 요청 | 원 요청 결과 확인, 새 행동에 새 키 |
|409 JOB_ALREADY_RUNNING | 같은 작업 실행 중복 | 현재 진행 보기·취소 |
|409 EXPORT_INVALIDATED | 과거 확정 결과가 stale/철회됨 | 현재 선택 재작성·검토 |
|413 INPUT_LIMIT_EXCEEDED / EXPORT_LIMIT_EXCEEDED | 정해진 크기/개수 한도 초과 | 자료/결과 범위 축소 |
|422 INVALID_SOURCE / INVALID_JSON / INVALID_REFERENCE | 형식·근거·참조 오류 | 지적된 입력 수정 |
|422 INVALID_DECISION / PREVIEW_MISMATCH | 현재 preview/선택 불일치 | 새 미리보기 확인 |
|422 RULE_NOT_REUSABLE / RULE_CONFLICT | 금지된 재사용/충돌 | 이번만 사용 또는 새 결정 |
|422 REQUIRED_DECISION_MISSING / EMPTY_APPROVED_CONTENT | 미결정/공개내용 없음 | 선택·자료·목표 조정 |
|422 GOAL_NOT_SATISFIED / REQUIRED_CHECK_FAILED | 재현목표/검사 미완료 | 재시도 또는 명시적 목표 변경 |
|422 INDEX_BASELINE_ZERO / INVALID_SERIES / INSUFFICIENT_OBSERVATIONS | 수치 변환 불가 | 다른 표현 또는 입력 확인 |
|503 PROVIDER_NOT_CONFIGURED / RUNNER_UNAVAILABLE | 사내 연결/확장 환경 없음 | 설정 확인. 필요한 검사인지 구분 |

비동기 job error_code는 AUTH_ERROR, PROVIDER_TIMEOUT, PROVIDER_UNAVAILABLE, PROVIDER_REQUEST_INVALID, CONTEXT_BUDGET_EXCEEDED, OUTPUT_TRUNCATED, INVALID_MODEL_OUTPUT, CALL_BUDGET_EXCEEDED, INTERRUPTED, TARGET_DIGEST_MISMATCH, TOOL_CONTRACT_ERROR 등을 사용한다. 고정 코드와 안전한 설명만 UI로 보내며 raw error는 내부 제한 기록이다.

## 7. 구현자가 임의로 바꾸면 안 되는 부분

JSON 필드/enum 이름, revision 증가, scope 구성, batch 원자성, 최종 hash, 사람 검토 범위, 기본 서버 주소, 저장 기준 자동 적용 조건을 바꾸려면 spec/contracts/ERD/기능/QA를 같은 PR로 수정한다. private helper 이름이나 함수 분할은 담당자가 결정할 수 있다. 구현 후 OpenAPI를 생성하더라도 이 문서와 다른 DTO를 별도로 유지하지 않는다.
