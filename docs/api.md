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

facts는 호출자가 이번 목적·수신자에게 공개하기로 승인한 표현이다. 원자료 sources나 추가 키를 같이 보내면 400 INVALID_CORE_INPUT이다. 실제 원자료 분석·승인 관리·검토·확정은 이후 구현할 범위이며 이 API가 승인 권한을 자동 생성하지 않는다.

성공 응답은 document: title/body와 provenance: implementation/connection/ready다. provenance는 fake/real 코어와 direct/simulated 연결을 구분한다. 구현이 없는 실제 코어는 503 CORE_NOT_IMPLEMENTED, 가짜 연결 실패는 503 CORE_UNAVAILABLE, 취소는 CORE_CANCELLED다. 실제 앱에서 가짜 결과로 대체하지 않는다. 내부 예상밖 오류는 상세 내용을 숨긴 500 오류로 반환한다.

## 연출용 앱 전용 API

fake-app만 GET /__demo, GET /__demo.js, GET /api/demo/settings, PUT /api/demo/settings를 제공한다. 실제 app에서는 모두 404다. 설정 JSON은 script: title/opening/closing과 connection: delayMs/failuresRemaining이다. 지연은 0–30000 ms, 실패 수는 0–10이다. 설정을 바꾸면 다음 요청부터 적용한다.

문서 저장·조회 클라이언트는 SERVER_ORIGIN으로 대상을 바꿀 수 있다. 실제 앱은 8080, 가짜 앱은 8081이며 조절 화면은 가짜 앱에서 직접 연다.
