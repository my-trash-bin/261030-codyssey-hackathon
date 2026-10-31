# 실제 앱과 가짜 앱의 공통 HTTP API

아래 공통 API는 packages/server가 담당한다. app과 fake-app은 Core 구현만 주입한다. 원자료를 저장해도 자동 분석·재생성을 실행하지 않는다.

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| GET | /health | 서버 상태 확인 |
| GET | /api/documents | SQLite 문서 목록 |
| POST | /api/documents | `{"text":"내용"}` 저장 |
| GET | /api/core | implementation, connection, ready 조회 |
| POST | /api/sharing | 승인한 facts로 주입된 Core 호출 |

POST는 application/json을 사용하며 본문 상한은 1 MiB다. 문서 저장 응답은 201과 document, 목록은 200과 documents다. 빈 텍스트·불필요 필드는 400, JSON 이외 Content-Type은 415다.

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

`writeReviewed`의 수정 루프는 라이브러리 전용이다. `/api/sharing`의 `generate`는 작성·검토 한 번만 수행하고 검토 통과 후 기존 title/body 응답을 반환한다. task/decision API나 자동 공개 승인 기능은 추가하지 않았다.

## 연결 설정과 내부 저장

앱은 SAFEHANDOFF_LLM_BASE_URL, SAFEHANDOFF_LLM_MODEL, SAFEHANDOFF_LLM_API_KEY를 provider의 환경 변수 이름 설정으로 조회한다. SAFEHANDOFF_CONFIG는 설정 파일 경로이며 생략하면 config.json, 없으면 config.example.json이다. SAFEHANDOFF_REPRO_REGISTRY는 reproduction.enabled일 때만 읽는 설치 시 등록 파일이다. 상대 경로 기준은 저장소 루트다. 값은 API 응답에 노출하지 않는다.

`TaskStore`의 revision 검사·미리보기 hash 검증·원자적 결정 배치·철회·만료는 내부 라이브러리다. task/decision HTTP 엔드포인트는 추가하지 않았으며 `/api/v1/tasks`는 계속 404다. 인증·CSRF·Host/Origin 검사와 전체 task.v1은 후속 범위다. `/api/sharing`의 facts 입력이 이 저장 계층의 사람 승인을 증명하지는 않는다.

provider.response_mode=text이면 모델 호출의 JSON 출력 요청도 HTTP response_format 필드를 추가하지 않는다. JSON 기능 미지원 호환 서버는 프롬프트로 JSON을 생성하고 Engine이 같은 엄격한 응답 검증을 수행한다. response_mode=json일 때만 JSON 응답 형식 필드를 전송한다.

## grounding 내부 계약

HTTP 필드와 환경 변수는 추가하지 않았다. Engine.review의 세 번째 인수와 writeReviewed의 grounding 옵션에는 ReviewGroundingContext를 준다. 입력이 없거나 현재 결정·scope·source·preview·rule·goal·만료와 모순되면 모델 호출 전에 needs_decision/NEEDS_DISCLOSURE_DECISION을 반환한다. composeFactPack은 여전히 FactPack을 반환하고, FactGrounding은 별도 groundFacts 함수로 계산한다. Decision의 applied_rule_id/version은 필수이며 fresh는 빈 문자열/0이다.

Core.generate는 기존 호출자가 제공한 승인 facts만 명시적 fresh context로 연결하고 검토 통과 후 응답한다. 원자료 purpose를 공개 brief로 자동 복사하지 않는다. 범용 review가 metadata 누락을 fresh로 추정하지는 않는다. TaskStore의 현재 내부 레코드를 이 경로에 자동 이식하지 않았으며 Rule 매칭·저장·UI와 runtime revision/CAS 채택은 후속이다.

OSS 스모크의 로컬 보고서는 execution_summary의 구조화된 실행 수치를 포함한다. completed는 파이프라인 완료이며 문서 최종화가 아니다. document_status=reviewed_draft_not_finalized, manual_review_required=true를 함께 기록한다. 문장 의미 판정은 자동 회귀 시험에 넣지 않는다.

## 로컬 실행 transcript

SAFEHANDOFF_TRANSCRIPT_DIR를 설정하면 실제 app과 OSS 스모크의 Engine 작성·검토 실행을 실행별 JSONL로 기록한다. 상대 경로는 저장소 루트 기준이며 생략하면 꺼진다. SAFEHANDOFF_TRANSCRIPT_CONTENT=1은 모델 입력·검증된 작성 초안을 추가하는 명시적 opt-in이며 DIR 없이 설정하면 시작 오류다. 기본 메타데이터에는 본문이 없다. API 키·endpoint·모델 이름·reviewer 내부 설명은 자동 기록하지 않는다. 본문 속 비밀 자동 제거 기능은 없다.

기존 HTTP 요청·응답 필드는 그대로이며 transcript 조회 API는 없다. 파일은 로컬 내부 기록이고 녹화 재생은 실제 호출 표시와 구분해야 한다. [이벤트 계약과 보존 제한](transcript.md)을 따른다. 작업 삭제 연동·상시 24시간 만료는 후속 구현이다.

## ToyRecord 팩 스모크

HTTP 필드와 환경 변수는 추가하지 않았다. OSS CLI는 `--catalog`와 `--pack-version`을 함께 받으며 `--registration`의 pack pin·target·정확한 image digest를 대조한다. `--seed`는 기본 42인 unsigned 32-bit 정수다. 기존 catalog 없는 image 등록 경로도 유지한다. 새 bound installation을 catalog 없이 쓰면 거부한다. 보고서 selected_pack과 transcript pack_selected가 같은 팩 지문을 담는다. [명세·실행 절차](toyrecord-pack.md)를 따른다.


## F02 분석 라이브러리

HTTP 경로·환경 변수는 추가하지 않았다. 주입된 Engine의 `analyze({task,sources}, {signal?})`는
base64 원자료·source SHA-256·version·included 바인딩을 검사하고 `{evidence,proposals}`를
반환한다. 이 결과는 공개 결정·서버 candidate_set 채택·의미 정확도 검증 완료가 아니다.
[파서 위치·한도·nullable 정규화·오류 계약](f02-analyze-plan.md)을 따른다. 원자료는 analysis 역할의
설정된 모델로만 전달하고 writer 세션과 공유하지 않는다. 현재 라이브러리 자체가 프로세스의
인터넷 차단이나 DB 권한·revision/CAS를 집행하는 것은 아니다. 분석 본문은 transcript에 기록하지 않는다.


## F02 내부 저장·채택

새 HTTP 경로·환경 변수는 없다. 기존 `/api/analysis`는 stateless이고 task/decision CRUD와
job polling API를 추가하지 않았다. TaskStore의 migration v2는 source version/선택, evidence,
분석 job snapshot, 후보 provenance를 추가하며 기존 문서·후보·결정을 보존한다.

내부 호출 순서는 `store.analysis.replaceSources(id, revision, sources)` 후
`runTaskAnalysis(store, engine, id, revision, {signal?})`다. 분석 시작은 이전 현재 후보·결정을
무효화하고 revision을 올린다. 성공 채택도 새 revision이며 오래된 결과는 adopted=false다.
모델 없는 `analysis.addManual`은 candidate와 evidence_ids 또는 user_note 중 하나를 받는다.
현재 후보를 새 ID로 복제하되 선택은 옮기지 않으며 revision은 한 번 증가한다.

새 내부 오류는 INVALID_ANALYSIS/ANALYSIS_NOT_FOUND다. 삭제된 job은 다시 만들지 않으며
취소·실패·stale terminal 상태를 성공으로 복귀시키지 않는다. caller가 내부 job/source 조회 결과를
일반 로그·공개 응답으로 직렬화하면 안 된다. [전체 내부 범위](f02-analyze-plan.md)를 따른다.
