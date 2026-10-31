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
