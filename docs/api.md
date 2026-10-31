# 실제 앱과 가짜 앱의 공통 HTTP API

아래 공통 API는 packages/server가 담당한다. app과 fake-app은 Core 구현만 주입한다. 원자료를 저장해도 자동 분석·재생성을 실행하지 않는다.

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| GET | /health | 서버 상태 확인 |
| GET | /api/documents | SQLite 문서 목록 |
| POST | /api/documents | `{"text":"내용"}` 저장 |
| GET | /api/core | implementation, connection, ready 조회 |
| POST | /api/sharing | 승인한 facts로 주입된 Core 호출 |
| POST | /api/analysis | 주입된 Engine으로 원자료를 분석해 근거와 후보 제안을 반환 |

POST는 application/json을 사용하며 본문 상한은 기본 1 MiB, `/api/analysis`만 1.5 MiB다. 문서 저장 응답은 201과 document, 목록은 200과 documents다. 빈 텍스트·불필요 필드는 400, JSON 이외 Content-Type은 415다.

## 코어 계약

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

facts는 호출자가 이번 목적·수신자에게 공개하기로 승인한 표현이다. 원자료 sources나 추가 키를 같이 보내면 400 INVALID_CORE_INPUT이다. 원자료 분석·공개 승인 API·최종 확정은 이후 구현할 범위이며 이 API가 승인 권한을 자동 생성하지 않는다.

성공 응답은 document: title/body와 provenance: implementation/connection/ready다. provenance는 fake/real 코어와 direct/simulated 연결을 구분한다. 모델 설정 없음·호출 실패·검토 실패는 503 CORE_UNAVAILABLE, 미구현 기능은 CORE_NOT_IMPLEMENTED, 취소는 CORE_CANCELLED다. 실제 앱에서 가짜 결과로 대체하지 않는다. 내부 예상밖 오류는 상세 내용을 숨긴 500 오류로 반환한다.

## 연출용 앱 전용 API

fake-app만 GET /__demo, GET /__demo.js, GET /api/demo/settings, PUT /api/demo/settings를 제공한다. 실제 app에서는 모두 404다. 설정 JSON은 script: title/opening/closing과 connection: delayMs/failuresRemaining이다. 지연은 0–30000 ms, 실패 수는 0–10이다. 설정을 바꾸면 다음 요청부터 적용한다.

문서 저장·조회 클라이언트는 SERVER_ORIGIN으로 대상을 바꿀 수 있다. 실제 앱은 8080, 가짜 앱은 8081이며 조절 화면은 가짜 앱에서 직접 연다.

## 주입형 Engine 라이브러리

HTTP 필드는 변경하지 않았다. 앱 진입점은 설정 파일과 환경 변수에서 모델을 구성해 주입한다. 모델과 EngineConfig를 주입한 RealCore는 작성·검토를 수행하며, 실패·예산 초과·통과하지 못한 검토는 기존 CORE_UNAVAILABLE로 매핑한다. 취소는 CORE_CANCELLED다.

`writeReviewed`의 수정 루프는 라이브러리 전용이다. `/api/sharing`의 `generate`는 작성·검토 한 번만 수행하고 검토 통과 후 기존 title/body 응답을 반환한다. 이 경로에 task/decision API나 자동 공개 승인 기능은 추가하지 않았다. 같은 저장 계층의 task·공개 결정 API는 아래 `인증된 task·공개 결정 API` 절에서 별도로 연다.

## 연결 설정과 내부 저장

앱은 SAFEHANDOFF_LLM_BASE_URL, SAFEHANDOFF_LLM_MODEL, SAFEHANDOFF_LLM_API_KEY를 provider의 환경 변수 이름 설정으로 조회한다. SAFEHANDOFF_CONFIG는 설정 파일 경로이며 생략하면 config.json, 없으면 config.example.json이다. SAFEHANDOFF_REPRO_REGISTRY는 reproduction.enabled일 때만 읽는 설치 시 등록 파일이다. 상대 경로 기준은 저장소 루트다. 값은 API 응답에 노출하지 않는다.

`TaskStore`의 revision 검사·미리보기 hash 검증·원자적 결정 배치·철회·만료는 내부 라이브러리다. 같은 동작을 아래 `인증된 task·공개 결정 API`가 HTTP로 노출하며, `SAFEHANDOFF_WORKFLOW_ENABLED=1`로 켠 단일 운영자 loopback 환경에서만 활성화된다. 미설정·fake-app은 503 `WORKFLOW_API_DISABLED`다. 다중 사용자 인증·LAN 운영·외부 제출과 참고 task.v1 전체 필드는 구현 범위가 아니다. `/api/sharing`의 facts 입력이 이 저장 계층의 사람 승인을 증명하지는 않는다.

provider.response_mode=text이면 모델 호출의 JSON 출력 요청도 HTTP response_format 필드를 추가하지 않는다. JSON 기능 미지원 호환 서버는 프롬프트로 JSON을 생성하고 Engine이 같은 엄격한 응답 검증을 수행한다. response_mode=json일 때만 JSON 응답 형식 필드를 전송한다.

## grounding 내부 계약

HTTP 필드와 환경 변수는 추가하지 않았다. Engine.review의 세 번째 인수와 writeReviewed의 grounding 옵션에는 ReviewGroundingContext를 준다. 입력이 없거나 현재 결정·scope·source·preview·rule·goal·만료와 모순되면 모델 호출 전에 needs_decision/NEEDS_DISCLOSURE_DECISION을 반환한다. composeFactPack은 여전히 FactPack을 반환하고, FactGrounding은 별도 groundFacts 함수로 계산한다. Decision의 applied_rule_id/version은 필수이며 fresh는 빈 문자열/0이다.

Core.generate는 기존 호출자가 제공한 승인 facts만 명시적 fresh context로 연결하고 검토 통과 후 응답한다. 원자료 purpose를 공개 brief로 자동 복사하지 않는다. 범용 review가 metadata 누락을 fresh로 추정하지는 않는다. TaskStore의 현재 내부 레코드를 이 경로에 자동 이식하지 않았으며 Rule 매칭·저장·UI와 runtime revision/CAS 채택은 후속이다.

OSS 스모크의 로컬 보고서는 execution_summary의 구조화된 실행 수치를 포함한다. completed는 파이프라인 완료이며 문서 최종화가 아니다. document_status=reviewed_draft_not_finalized, manual_review_required=true를 함께 기록한다. 문장 의미 판정은 자동 회귀 시험에 넣지 않는다.

## 로컬 실행 transcript

SAFEHANDOFF_TRANSCRIPT_DIR를 설정하면 실제 app과 OSS 스모크의 Engine 작성·검토 실행을 실행별 JSONL로 기록한다. 상대 경로는 저장소 루트 기준이며 생략하면 꺼진다. SAFEHANDOFF_TRANSCRIPT_CONTENT=1은 모델 입력·검증된 작성 초안을 추가하는 명시적 opt-in이며 DIR 없이 설정하면 시작 오류다. 기본 메타데이터에는 본문이 없다. API 키·endpoint·모델 이름·reviewer 내부 설명은 자동 기록하지 않는다. 본문 속 비밀 자동 제거 기능은 없다.

기존 HTTP 요청·응답 필드는 그대로이며 transcript 조회 API는 없다. 파일은 로컬 내부 기록이고 녹화 재생은 실제 호출 표시와 구분해야 한다. [이벤트 계약과 보존 제한](transcript.md)을 따른다. 작업 삭제 연동·상시 24시간 만료는 후속 구현이다.

## fake-app CDP 연출 화면

GET `/__presentation`, `/__presentation.js`, `/__presentation.css`는 fake-app만 제공하는 고정 자원입니다.
기존 `/__demo` 설정 화면과 병행하며 실제 app이나 공통 server에는 추가하지 않습니다.
연출의 분석·공개 선택은 브라우저 상태이며 새로운 task/decision API가 아닙니다.
생성·저장·조회는 위 `/api/sharing`, `/api/documents` 계약을 그대로 사용합니다.

## ToyRecord 팩 스모크

HTTP 필드와 환경 변수는 추가하지 않았다. OSS CLI는 `--catalog`와 `--pack-version`을 함께 받으며 `--registration`의 pack pin·target·정확한 image digest를 대조한다. `--seed`는 기본 42인 unsigned 32-bit 정수다. 기존 catalog 없는 image 등록 경로도 유지한다. 새 bound installation을 catalog 없이 쓰면 거부한다. 보고서 selected_pack과 transcript pack_selected가 같은 팩 지문을 담는다. [명세·실행 절차](toyrecord-pack.md)를 따른다.


## F02 분석 라이브러리

`POST /api/analysis`를 추가했으며 환경 변수는 추가하지 않았다. 실제 앱은 Engine을 주입하고,
Engine이 없는 앱에서는 503 `CORE_NOT_IMPLEMENTED`를 반환한다. 잘못된 분석 입력은 400,
모델 오류는 503으로 반환한다. 연결 종료는 분석 취소 신호로 전달한다.

주입된 Engine의 `analyze({task,sources}, {signal?})`는 base64 원자료·source SHA-256·version·
included 바인딩을 검사하고 `{evidence,proposals}`를 반환한다. 이 응답은 공개 결정이 아니며
`/api/analysis`는 결과를 저장하지 않는다. 별도 내부 경로 `TaskStore.analysis`·`runTaskAnalysis`가
source·evidence·job을 저장하고 CAS로 채택하지만 이 라우트와 연결되지 않았다.
[파서 위치·한도·nullable 정규화·오류 계약](f02-analyze-plan.md)을 따른다. 원자료는 analysis 역할의
설정된 모델로만 전달하고 writer 세션과 공유하지 않는다. 현재 라이브러리 자체가 프로세스의
인터넷 차단이나 DB 권한·revision/CAS를 집행하는 것은 아니다. 분석 본문은 transcript에 기록하지 않는다.


## F02 내부 저장·채택

이 절의 분석 라이브러리는 새 HTTP 경로를 만들지 않는다. 기존 `/api/analysis`는 stateless로
유지한다. task/decision CRUD와 job polling은 아래 `인증된 task·공개 결정 API` 절에서 별도로
열며, 그 경로가 이 저장 함수를 호출한다. TaskStore의 migration v2는 source version/선택, evidence,
분석 job snapshot, 후보 provenance를 추가하며 기존 문서·후보·결정을 보존한다.

내부 호출 순서는 `store.analysis.replaceSources(id, revision, sources)` 후
`runTaskAnalysis(store, engine, id, revision, {signal?})`다. 분석 시작은 이전 현재 후보·결정을
무효화하고 revision을 올린다. 성공 채택도 새 revision이며 오래된 결과는 adopted=false다.
모델 없는 `analysis.addManual`은 candidate와 evidence_ids 또는 user_note 중 하나를 받는다.
현재 후보를 새 ID로 복제하되 선택은 옮기지 않으며 revision은 한 번 증가한다.

새 내부 오류는 INVALID_ANALYSIS/ANALYSIS_NOT_FOUND다. 삭제된 job은 다시 만들지 않으며
취소·실패·stale terminal 상태를 성공으로 복귀시키지 않는다. caller가 내부 job/source 조회 결과를
일반 로그·공개 응답으로 직렬화하면 안 된다. [전체 내부 범위](f02-analyze-plan.md)를 따른다.

## 인증된 task·공개 결정 API (단일 운영자 개발용)

기존 `/api/analysis`는 stateless로 유지한다. 아래 v1 경로는 실제 앱에서
`SAFEHANDOFF_WORKFLOW_ENABLED=1`로 켠 경우 활성화된다. 기존 WORKFLOW_TOKEN 설정도 활성화 입력으로 지원한다. 미설정·fake-app은
503 `WORKFLOW_API_DISABLED`다. 기존 `/api/documents`·`/api/sharing`·`/api/analysis`의 인증을
이 설정이 대신하지 않는다. 다중 사용자·LAN 운영 인증이나 외부 제출을 구현한 것이 아니다.

`SAFEHANDOFF_WORKFLOW_BROWSER_ORIGIN`은 브라우저의 정확한 origin(기본
`http://127.0.0.1:5173`), `SAFEHANDOFF_WORKFLOW_SERVER_ORIGIN`은 API origin(기본
`http://127.0.0.1:${PORT}`)이다. 둘 다 HTTP loopback만 지원한다. localhost와 127.0.0.1은
서로 다른 값이다. 클라이언트 프록시는 실제 API Host를 사용하고 브라우저 Origin·Cookie·
X-CSRF-Token·Idempotency-Key와 Set-Cookie를 전달한다. 임의 origin·와일드카드는 허용하지 않는다.

### 세션

- `POST /api/v1/session`: 정확한 브라우저 Origin, JSON `{ "token": "시작 시 터미널에 표시한 5분·1회용 토큰" }`.
  성공은 `{data:{csrf_token,expires_at,analysis_environment,capabilities}}`와 8시간 고정 HttpOnly·
  SameSite=Strict·Path=/ 쿠키다. 이 개발 API는 loopback HTTP만 허용하므로 Secure 쿠키를
  사용하지 않는다. 인증된 `GET /api/v1/session`은 같은 DTO를 반환한다. 서버 재시작 시 세션은 만료된다.
- 모든 v1 조회도 세션이 필요하다. 세션 없음/만료는 401 `AUTH_REQUIRED`, Host/Origin 거부와
  CSRF 실패는 403이다. GET은 Origin 생략이 가능하고, 쓰기는 정확한 Origin과 CSRF가 필수다.
- `analysis_environment`는 `{provider_origin:string|null,approval_status:
  "operator_confirmation_required",verified_at:null}`이다. provider origin은 실제 설정의
  환경 변수 이름으로 조회하며 경로·query·사용자명·비밀번호를 제거한다. 모델 키는 반환하지 않는다.
  주소 표시는 사내·로컬 승인이나 모델 연결 성공의 증거가 아니다. 운영자가 확인해야 한다.
- `capabilities`는 tasks/selected_fields/reusable_rules/artifacts/exports=true, approved_excerpt=false다.
  세션은 하나의 로컬 운영자 권한이며 task별 사용자 소유권을 구현한 것으로 해석하지 않는다.

### 요청·응답

성공은 `{data: ...}`, 오류는 `{error: "CODE"}`다. JSON 쓰기는 Content-Type이 필요하고
본문 상한은 1.5 MiB다. 세션 생성 외 모든 쓰기는 1~200자 Idempotency-Key를 요구한다.
같은 경로·키·본문 재전송은 최초 결과를 반환하고, 다른 본문은 409 `IDEMPOTENCY_CONFLICT`다.
본문 키 순서까지 동일하게 재전송한다. task 생성 외 쓰기는 양의 정수 expected_revision을 사용한다.
판본 불일치는 409 `REVISION_CONFLICT`이며 부분 저장하지 않는다. 키·결과는 SQLite에 영속한다.
원자료와 공개 projection을 담을 수 있는 task별 재전송 기록은 task 삭제와 함께 삭제된다.
생성 요청의 재전송 결과는 삭제 시 `{id,deleted:true}`로 바꿔 context를 남기지 않는다.

| 경로 | 본문 또는 응답 data |
| --- | --- |
| POST /api/v1/tasks | `{context:{purpose,recipient,goal_variant?,output_language?}}` → 201 StoredTask |
| GET /api/v1/tasks/{id} | 현재 task 집계(아래 설명) |
| PUT /api/v1/tasks/{id}/sources | `{expected_revision,sources:SourceDocument[]}` → StoredTask |
| POST /api/v1/tasks/{id}/jobs | `{expected_revision,kind:"analyze"}` → 202 job 요약 |
| GET /api/v1/tasks/{id}/jobs/{job_id} | 분석 job 요약. 원자료 snapshot은 반환하지 않음 |
| POST /api/v1/tasks/{id}/jobs/{job_id}/cancel | `{expected_revision}` → 202 `{cancel_requested:boolean,job_id}` |
| POST /api/v1/tasks/{id}/manual-candidates | `{expected_revision,candidate,evidence_ids? 또는 user_note?}` → 201 StoredTask |
| GET /api/v1/tasks/{id}/candidates/{candidate_id}/fields | `{candidate_id,input_revision,source_version_id,fields:string[],reusable:false}` |
| POST /api/v1/tasks/{id}/disclosure-previews | `{expected_revision,candidate_id,representation}` → DisclosurePreview |
| POST /api/v1/tasks/{id}/jobs | `{expected_revision,kind:"interpret_disclosure",arguments:{candidate_id,text}}` → 202 조건 해석 job |
| GET /api/v1/jobs/{job_id} | 조건 해석 job. 현재 판본이 다르면 stale·result=null |
| POST /api/v1/tasks/{id}/decision-batches | `{expected_revision,accept_scope_reduction:boolean,operations:[...]}` → StoredTask |
| POST /api/v1/tasks/{id}/decisions/{decision_id}/revoke | `{expected_revision}` → StoredTask |
| DELETE /api/v1/tasks/{id} | `{expected_revision,confirmation:"DELETE",acknowledge_saved_rules_retained:true}` → `{id,deleted:true}` |

StoredTask는 id/revision/phase/context/source_set_hash/skill_set_hash/current_candidate_set_id다.
집계는 여기에 sources/evidence/candidates/decisions/scope/intake와 현재 job·artifact 포인터를 추가한다.
sources는 메타데이터만 반환하고 raw_bytes는 되돌려주지 않는다. 원자료 바이트는 내부 snapshot에만 보관한다. candidates는 서버 id,
분석 local_key, origin(model/manual), selector=null, conflicts, required와 기존 Candidate 필드를
포함한다. 임시 local_key→영속 id 대응은 이 목록으로 확인한다. decisions는 candidate_id별 현재
결정 객체이며 representation/projection_sha256/revoked/expires_at을 포함한다. scope는 task ID와
purpose/recipient의 SHA-256·skill hash에 묶은 서버 내부 범위다. 카탈로그 Rule scope를 대신하지 않는다.
참고 task.v1 전체 필드를 보장하는 API로 해석하지 않는다.

SourceDocument 형식·hash·base64와 한도는 앞의 `/api/analysis`와 같다. sources 교체는 revision을
한 번 올리고 이전 후보·결정을 무효화한다. 분석 시작도 revision을 한 번 올리고, 완료 채택은
한 번 더 올린다. 분석 job은 id/task_id/revision/input_revision/kind/status/error_code를 반환한다.
상태는 running/succeeded/failed/cancelled/stale다. 등록한 원자료 snapshot으로만 Engine을 호출하고
브라우저의 AnalyzeResult는 받지 않는다. 모델 대기 중 DB 트랜잭션을 유지하지 않는다. 재분석·취소·
삭제·원자료 변경 뒤 늦은 응답은 후보나 허용 결정을 만들 수 없다. job 최대 동시 실행은 4개이며
초과는 429 `JOB_LIMIT`, 프로세스 재시작 후 미완료 job은 INTERRUPTED로 실패 처리한다.

수동 candidate는 kind/uncertainty/statement/relevance/purpose_relevance다. evidence_ids와
user_note 중 정확히 하나만 지정한다. user_note는 서버 소유 원자료·근거로 저장하며 모델 호출과
공개 결정을 만들지 않는다. 다른 task·현재 선택에서 제거한 source의 참조는 거부한다.

### 표현과 결정

- A: `{kind:"fact_summary",transform_id:"",parameters:{}}`. 현재 후보 문장을 그대로 미리보기한다.
  자동으로 구체 값이 제거됐다고 보장하지 않는다. 사람이 실제 표시 문장을 보고 승인한다.
- B: 단일 CSV의 한 숫자 열에 연결된 후보만 `series_direction_only.v1` derived_table을 지원한다.
  `series_index_base100.v1`은 parameters에 decimal_places(0~4)를 선택할 수 있다.
- C: `{kind:"selected_fields",transform_id:"select_fields.v1",parameters:{fields:[...]}}`.
  단일 CSV/JSON의 후보에 연결된 검증된 근거만 선택 가능하다. CSV는 논리 행 순서의 실제 셀,
  JSON은 정확한 JSON pointer(루트는 빈 문자열)를 사용한다. 혼합 소스·목록 밖 필드·중복 필드·
  빠진 CSV 셀을 거부한다. CSV 따옴표·개행과 JSON 문자열을 실제 값으로 복원하며 선택하지 않은
  필드 값은 projection에 포함하지 않는다. exact_value는 단일 CSV/JSON 근거 값만 지원한다.
- D: 조건과 후보 하나·task context만 disclosure 역할 모델에 보내 strict 검증한 제안을 반환한다.
  supported/ambiguous/unsupported는 승인 상태가 아니다. 지원 제안도 실제 미리보기 검증을 거쳐야
  한다. 해석 job은 미리보기·결정·Rule을 만들지 않고, 모델·retry·입력 예산은 기존 설정을 따른다.
- approved_excerpt·타임라인 표현과 미지원 job은 422로 거부한다. C/정확한 값/원문은 재사용할 수
  없으며 재사용 저장은 catalog scope와 파서 인증된 단일 CSV 숫자 열의 방향/지수 변환에만 허용한다.
  일반 요약 문장·selected_fields·exact_value·원문 저장은 422 RULE_NOT_REUSABLE로 거부한다.

미리보기는 서버가 계산한 projection을 불변 저장하고 현재 revision/source hash/context와 결합한다.
응답은 schema_version/preview_id/candidate_id/input_revision/representation/projection/
projection_sha256/raw_grants이며 여기서는 raw_grants=[]다. projection은 statement/columns/rows다.
최종 원문 예외 승인은 이번 구현에 없다.

operations의 allow는 candidate_id/disposition/representation/preview_id/projection_sha256와
save_reusable_rule(boolean)를 보낸다. true는 같은 트랜잭션에서 유효한 현재 결정으로 규칙을 저장한다. exclude/defer는 candidate_id/disposition만 보낸다.
expires_at은 선택 가능하며 과거 시각은 거부한다. 필수 후보 exclude에는 accept_scope_reduction=true가
필요하다. preview·representation·hash·source·scope·revision·후보 참조 중 하나라도 다르면 전체 배치를
거부한다. 적용은 revision을 한 번 올린다. 철회도 판본을 올리고 과거 허용으로 복귀하지 않는다.

404 TASK_NOT_FOUND/ANALYSIS_NOT_FOUND와 404 ENDPOINT_NOT_FOUND, 비활성 API의 503을 구분한다.
미지원 기능은 422다. 서버 API 제공과 task 생성/저장·C 필드 선택·초안·확정·Rule 관리 화면 연결은 구분한다. 후속 UI 접점은 [요청 현황](ui-api-requests.md)에 적는다.


## 초안·파일·규칙·이력 API

`SAFEHANDOFF_WORKFLOW_ENABLED=1`은 암호학적 시작 토큰을 터미널에 한 번 표시한다.
토큰은 프로세스 시작부터 5분·1회만 유효하고 DB·transcript·응답에 저장하지 않는다.
기존 SAFEHANDOFF_WORKFLOW_TOKEN(32자 이상)은 같은 수명/사용 제한을 따르며 터미널에 재표시하지 않는다.
DELETE /api/v1/session은 Origin·CSRF·멱등 키를 확인해 로그아웃하고 쿠키를 지운다.
세션은 갱신 없는 8시간 고정이며 재시작 시 폐기한다. app·client의 기본 bind는 127.0.0.1이다.

SAFEHANDOFF_WORKFLOW_CATALOG는 운영자 JSON 경로다. 형식은 projects/recipients 배열이며
각 항목은 `{id,display_name}`이다. 생략 시 두 목록은 빈 배열이다. 가상 예제는
`fixtures/workflow/catalog.json`이며 실제 운영 설정으로 자동 채택하지 않는다.
목적은 oss_issue/vendor_support/operations_advice, goal은 default/observations_only/
ask_for_diagnostics/reproduction_evidence다. 연결되지 않은 확장 팩을 설치 상태로 표시하지 않는다.

모든 경로는 기존 세션·쓰기 CSRF/Origin/Host·멱등 키 규칙을 따른다. 성공 data envelope를 사용한다.

| 경로 | 입력과 결과 |
| --- | --- |
| GET /api/v1/catalog | 프로젝트·목적·수신자·goal·양식·활성 확장(현재 빈 배열)·실제 한도 |
| GET /api/v1/runtime | core 모드·model_id·app_version·확장·검사기·재현 설정·debug 정책. URL·키·토큰·내부 경로 제외 |
| GET /api/v1/tasks?cursor=... | 최근 수정순 30개, tasks와 next_cursor. 원자료·모델 응답 없음 |
| POST /api/v1/tasks | `{intake:{internal_title,project_id,purpose_id,recipient_id,audience,skill_ids,goal_variant?,output_language?}}` |
| GET /api/v1/tasks/{id}/sources | 등록 판본 메타데이터·byte_size·선택 여부. raw_bytes 없음 |
| DELETE /api/v1/tasks/{id}/sources/{source_id} | `{expected_revision}`. logical source_id 선택 해제·후보/결정 무효화 |
| GET /api/v1/tasks/{id}/events?after=seq | 시간순 seq/revision/kind/created_at. duration_ms·usage는 미측정(null) |
| GET /api/v1/tasks/{id}/events (Accept: text/event-stream) | Last-Event-ID 이후 재생과 새 이벤트. 세션 만료/종료 시 닫음 |
| POST /api/v1/tasks/{id}/jobs | kind=compose, `{expected_revision,kind,arguments?:{provisional?:boolean}}` |
| POST /api/v1/tasks/{id}/jobs | kind=review, arguments는 `{artifact_id,expected_artifact_set_hash}` |
| GET /api/v1/jobs/{id} | 분석·조건 해석·초안/검토 job의 kind/status/input_revision·artifact_id·고정 오류 코드 |
| GET /api/v1/artifacts/{id} | DocAST·검토·파일 메타데이터·hash·현재 여부. 내부 승인팩/grounding은 반환하지 않음 |
| GET /api/v1/tasks/{id}/bundle | 가장 최근 artifact와 실제 파일 목록. 과거 판본은 is_current=false |
| GET /api/v1/artifacts/{id}/files/{path} | 내부 확인용 실제 UTF-8 파일 바이트. 확정 다운로드 권한과 별개 |
| PUT /api/v1/artifacts/{id}/edit | `{expected_revision,expected_document_hash,draft}` → 새 revision/artifact, 검토 무효 |
| POST /api/v1/artifacts/{id}/human-review | `{expected_revision,target_hash,checklist,fallback_reason}` → 새 revision/artifact |
| POST /api/v1/tasks/{id}/finalize | `{expected_revision,artifact_id,expected_artifact_set_hash,confirmed:true}` → 불변 export |
| GET /api/v1/exports/{id}/files/{path} | 확정한 동일 바이트, Content-Disposition: attachment |
| GET /api/v1/exports/{id}/archive | 저장된 동일 ZIP, archive_sha256으로 확인 가능 |
| GET /api/v1/rules | logical ID별 최신 판본·scope·selector·표현·만료·철회 |
| POST /api/v1/rules | `{task_id,expected_revision,decision_id}`. 현재 유효한 allow에서 별도 규칙 저장 |
| POST /api/v1/rules/{id}/versions | `{expected_rule_version,representation,expires_at}`. 새 불변 판본 |
| POST /api/v1/rules/{id}/revoke | `{expected_rule_version}`. 전 판본 철회·영향 task revision 증가 |
| POST /api/v1/tasks/{id}/rules/apply | `{expected_revision,rule_refs:[{id,version}]}`. 전부 성공 또는 전부 거부 |

intake는 catalog 밖 ID·등록되지 않은 skill_ids를 거부한다. 현재 skill_ids는 빈 배열만 받는다.
기존 context 기반 작업 생성도 유지하되, catalog scope가 없는 작업은 재사용 규칙을 저장할 수 없다.
PUT sources는 included=false도 검증해 보관하며 선택에서는 제외한다. 분석은 included=true만 읽는다.
한도는 100개·개당 256 KiB·합계 1 MiB·근거 100개이며 catalog와 코드가 같은 값을 쓴다.

초안 시작과 채택, 편집·검토·사람 검토·확정은 각각 새 revision을 만든다. 새 입력 뒤 늦은 결과는
현재 초안을 덮지 않는다. 조회 phase는 needs_analysis/needs_decisions/processing/needs_attention/
ready_to_generate/ready_to_finalize/finalized이고 current_job_id/current_artifact_id를 제공한다.
writer는 서버의 현재 유효 결정으로 구성한 FactPack만 받으며 원자료·원래 파일명·내부 제목은 받지 않는다.
작성 검토와 실제 렌더 파일 검토는 같은 모델 호출/repair 예산에 묶인다. retry·수정은 기존 config를 따른다.

파일은 support-request.md, observations-NNN.csv, manifest.json만 생성한다. HTML·외부 이미지/링크를
실행하지 않고 CSV 수식 문자열을 보호한다. manifest는 payload 상대경로·크기·hash만 포함한다.
artifact_set_hash는 manifest까지 포함한 정렬 메타데이터의 JSON hash다. ZIP은 고정 순서·
1980-01-01 시각·일반 파일 0644 권한이며 경로 탈출·중복 이름·심볼릭 링크 메타데이터를 거부한다.
확정·다운로드는 현재 revision·결정/규칙 활성·미보류·필수 fact·검토 대상 hash·파일 integrity를 재검사한다.
다운로드는 저장 바이트만 반환하며 renderer나 모델을 다시 실행하지 않는다. 무효화는 409 EXPORT_INVALIDATED다.
확정 뒤 편집도 새 revision과 재검토가 필요하다. reproduction_evidence 목표는 재현 증거 연결 전까지 확정 불가다.

사람 검토 checklist는 reviewed_all_files/approved_facts_only/uncertainty_preserved를 모두 true로 보낸다.
대상은 현재 artifact_set_hash다. 모델 timeout/unavailable의 의미 검토 대체만 허용하고, hard gate나
needs_changes/needs_decision을 우회할 수 없다. 주석·원문 슬롯·등록 asset·별도 맥락 검사 예외는 이번 지원에 없다.

규칙은 값이나 과거 문장이 아닌 source_slot·파서 인증 숫자 CSV 열 selector·변환만 저장한다.
방향/지수 변환만 재사용하며 새 바이트로 재계산한다. scope와 goal을 정확히 대조하고 최신 활성 판본만
새 적용에 쓴다. 과거 판본 fallback은 없다. 서로 다른 결과가 충돌하면 자동 허용하지 않고 이력에 남긴다.
선택·후보·파생 결정은 같은 트랜잭션에 채택하며, 명시 적용 충돌도 전체 거부한다. 전 판본 철회와
판본별 만료는 확정/다운로드에도 적용한다. 작업을 삭제해도 값·원문 없는 저장 규칙은 남는다.

취소 응답은 202 cancel_requested이며 worker 종료 전에는 완료로 표시하지 않는다. task 삭제는
confirmation=DELETE와 acknowledge_saved_rules_retained=true를 요구하고 실행 종료를 기다린 뒤 삭제한다.
클라이언트 프록시는 query·Last-Event-ID·스트림과 바이너리 바이트를 보존한다.
