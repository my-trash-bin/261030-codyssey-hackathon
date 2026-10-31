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

`TaskStore`의 revision 검사·미리보기 hash 검증·원자적 결정 배치·철회·만료는 내부 라이브러리다. 같은 동작을 아래 `인증된 task·공개 결정 API`가 HTTP로 노출하며, `SAFEHANDOFF_WORKFLOW_TOKEN`을 설정한 단일 운영자 loopback 환경에서만 활성화된다. 미설정·fake-app은 503 `WORKFLOW_API_DISABLED`다. 다중 사용자 인증·LAN 운영·외부 제출과 참고 task.v1 전체 필드는 구현 범위가 아니다. `/api/sharing`의 facts 입력이 이 저장 계층의 사람 승인을 증명하지는 않는다.

provider.response_mode=text이면 모델 호출의 JSON 출력 요청도 HTTP response_format 필드를 추가하지 않는다. JSON 기능 미지원 호환 서버는 프롬프트로 JSON을 생성하고 Engine이 같은 엄격한 응답 검증을 수행한다. response_mode=json일 때만 JSON 응답 형식 필드를 전송한다.

## grounding 내부 계약

HTTP 필드와 환경 변수는 추가하지 않았다. Engine.review의 세 번째 인수와 writeReviewed의 grounding 옵션에는 ReviewGroundingContext를 준다. 입력이 없거나 현재 결정·scope·source·preview·rule·goal·만료와 모순되면 모델 호출 전에 needs_decision/NEEDS_DISCLOSURE_DECISION을 반환한다. composeFactPack은 여전히 FactPack을 반환하고, FactGrounding은 별도 groundFacts 함수로 계산한다. Decision의 applied_rule_id/version은 필수이며 fresh는 빈 문자열/0이다.

Core.generate는 기존 호출자가 제공한 승인 facts만 명시적 fresh context로 연결하고 검토 통과 후 응답한다. 원자료 purpose를 공개 brief로 자동 복사하지 않는다. 범용 review가 metadata 누락을 fresh로 추정하지는 않는다. TaskStore의 현재 내부 레코드를 이 경로에 자동 이식하지 않았으며 Rule 매칭·저장·UI와 runtime revision/CAS 채택은 후속이다.

OSS 스모크의 로컬 보고서는 execution_summary의 구조화된 실행 수치를 포함한다. completed는 파이프라인 완료이며 문서 최종화가 아니다. document_status=reviewed_draft_not_finalized, manual_review_required=true를 함께 기록한다. 문장 의미 판정은 자동 회귀 시험에 넣지 않는다.

## 로컬 실행 transcript

SAFEHANDOFF_TRANSCRIPT_DIR를 설정하면 실제 app과 OSS 스모크의 Engine 작성·검토 실행을 실행별 JSONL로 기록한다. 상대 경로는 저장소 루트 기준이며 생략하면 꺼진다. SAFEHANDOFF_TRANSCRIPT_CONTENT=1은 모델 입력·검증된 작성 초안을 추가하는 명시적 opt-in이며 DIR 없이 설정하면 시작 오류다. 기본 메타데이터에는 본문이 없다. API 키·endpoint·모델 이름·reviewer 내부 설명은 자동 기록하지 않는다. 본문 속 비밀 자동 제거 기능은 없다.

기존 HTTP 요청·응답 필드는 그대로이며 transcript 조회 API는 없다. 파일은 로컬 내부 기록이고 녹화 재생은 실제 호출 표시와 구분해야 한다. [이벤트 계약과 보존 제한](transcript.md)을 따른다. 작업 삭제 연동·상시 24시간 만료는 후속 구현이다.

## fake-app CDP 연출 화면

GET `/__presentation`·`/__demo`는 fake-app만 제공하는 연출 화면이고, 그 화면의 스크립트와 스타일은 빌드된 Vite 번들(`/assets/*.js`)과 `/presentation.css`로 제공됩니다. 서버가 정적 자산을 내보내는 경로만 바뀌었고 HTTP API는 그대로입니다.
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
`SAFEHANDOFF_WORKFLOW_TOKEN`(32자 이상)을 설정한 경우에만 활성화된다. 미설정·fake-app은
503 `WORKFLOW_API_DISABLED`다. 기존 `/api/documents`·`/api/sharing`·`/api/analysis`의 인증을
이 설정이 대신하지 않는다. 다중 사용자·LAN 운영 인증이나 외부 제출을 구현한 것이 아니다.

`SAFEHANDOFF_WORKFLOW_BROWSER_ORIGIN`은 브라우저의 정확한 origin(기본
`http://127.0.0.1:5173`), `SAFEHANDOFF_WORKFLOW_SERVER_ORIGIN`은 API origin(기본
`http://127.0.0.1:${PORT}`)이다. 둘 다 HTTP loopback만 지원한다. localhost와 127.0.0.1은
서로 다른 값이다. 클라이언트 프록시는 실제 API Host를 사용하고 브라우저 Origin·Cookie·
X-CSRF-Token·Idempotency-Key와 Set-Cookie를 전달한다. 임의 origin·와일드카드는 허용하지 않는다.

### 세션

- `POST /api/v1/session`: 정확한 브라우저 Origin, JSON `{ "token": "운영자가 설정한 비밀" }`.
  성공은 `{data:{csrf_token,expires_at,analysis_environment,capabilities}}`와 1시간 HttpOnly·
  SameSite=Strict·Path=/api/v1 쿠키다. 이 개발 API는 loopback HTTP만 허용하므로 Secure 쿠키를
  사용하지 않는다. 인증된 `GET /api/v1/session`은 같은 DTO를 반환한다. 서버 재시작 시 세션은 만료된다.
- 모든 v1 조회도 세션이 필요하다. 세션 없음/만료는 401 `AUTH_REQUIRED`, Host/Origin 거부와
  CSRF 실패는 403이다. GET은 Origin 생략이 가능하고, 쓰기는 정확한 Origin과 CSRF가 필수다.
- `analysis_environment`는 `{provider_origin:string|null,approval_status:
  "operator_confirmation_required",verified_at:null}`이다. provider origin은 실제 설정의
  환경 변수 이름으로 조회하며 경로·query·사용자명·비밀번호를 제거한다. 모델 키는 반환하지 않는다.
  주소 표시는 사내·로컬 승인이나 모델 연결 성공의 증거가 아니다. 운영자가 확인해야 한다.
- `capabilities`는 tasks/selected_fields=true, reusable_rules/approved_excerpt=false다.
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
| POST /api/v1/tasks/{id}/jobs/{job_id}/cancel | `{expected_revision}` → `{cancelled:boolean}` |
| POST /api/v1/tasks/{id}/manual-candidates | `{expected_revision,candidate,evidence_ids? 또는 user_note?}` → 201 StoredTask |
| GET /api/v1/tasks/{id}/candidates/{candidate_id}/fields | `{candidate_id,input_revision,source_version_id,fields:string[],reusable:false}` |
| POST /api/v1/tasks/{id}/disclosure-previews | `{expected_revision,candidate_id,representation}` → DisclosurePreview |
| POST /api/v1/tasks/{id}/jobs | `{expected_revision,kind:"interpret_disclosure",arguments:{candidate_id,text}}` → 202 조건 해석 job |
| GET /api/v1/jobs/{job_id} | 조건 해석 job. 현재 판본이 다르면 stale·result=null |
| POST /api/v1/tasks/{id}/decision-batches | `{expected_revision,accept_scope_reduction:boolean,operations:[...]}` → StoredTask |
| POST /api/v1/tasks/{id}/decisions/{decision_id}/revoke | `{expected_revision}` → StoredTask |
| DELETE /api/v1/tasks/{id} | `{expected_revision}` → `{id,deleted:true}` |

StoredTask는 id/revision/phase/context/source_set_hash/skill_set_hash/current_candidate_set_id다.
집계는 여기에 sources/evidence/candidates/decisions/scope를 추가한다. sources는 인증된 내부
준비 화면용 원자료 바이트를 포함하므로 공유 초안에 전달하지 않는다. candidates는 서버 id,
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
초과는 429 `JOB_LIMIT`, 프로세스 재시작 후 미완료 job은 CORE_CANCELLED로 실패 처리한다.

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
  없으며 이 라운드에서는 모든 save_reusable_rule=true를 422 RULE_REUSE_NOT_IMPLEMENTED로 거부한다.

미리보기는 서버가 계산한 projection을 불변 저장하고 현재 revision/source hash/context와 결합한다.
응답은 schema_version/preview_id/candidate_id/input_revision/representation/projection/
projection_sha256/raw_grants이며 여기서는 raw_grants=[]다. projection은 statement/columns/rows다.
최종 원문 예외 승인은 이번 구현에 없다.

operations의 allow는 candidate_id/disposition/representation/preview_id/projection_sha256와
save_reusable_rule=false를 보낸다. exclude/defer는 candidate_id/disposition만 보낸다.
expires_at은 선택 가능하며 과거 시각은 거부한다. 필수 후보 exclude에는 accept_scope_reduction=true가
필요하다. preview·representation·hash·source·scope·revision·후보 참조 중 하나라도 다르면 전체 배치를
거부한다. 적용은 revision을 한 번 올린다. 철회도 판본을 올리고 과거 허용으로 복귀하지 않는다.

404 TASK_NOT_FOUND/ANALYSIS_NOT_FOUND와 404 ENDPOINT_NOT_FOUND, 비활성 API의 503을 구분한다.
미지원 기능은 422다. 이 API의 존재가 UI 로그인·task 생성/저장 화면·C 필드 선택·최종화·Rule·
공유 초안까지 연결됐다는 뜻은 아니다. 후속 UI 접점은 [요청 현황](ui-api-requests.md)에 적는다.
