# 현재 서버 API

현재 서버는 텍스트 문서 저장·조회만 제공한다. 다른 문서에 남아 있는 작업·공개 승인·분석·재생성 API는 제품 설계 또는 이전 구현 기록이며 현재 제공하지 않는다.

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| GET | /health | 상태 확인, `{"status":"ok"}` |
| GET | /api/documents | 저장된 문서를 최신 저장 순으로 조회 |
| POST | /api/documents | `{"text":"내용"}`을 SQLite에 저장 |

POST는 application/json만 받는다. 빈 텍스트·잘못된 JSON·text 이외 필드는 400, JSON 이외 Content-Type은 415다. 요청 본문은 최대 1 MiB다. 생성 성공은 201과 `{"document":{"id":"UUID","text":"내용","createdAt":"ISO 시각"}}`, 목록은 200과 `{"documents":[...]}`다. 알 수 없는 경로는 404다. 원문 저장 후 분석이나 재작성을 자동 실행하지 않는다.

브라우저는 클라이언트 서버의 같은 경로로 요청하며 클라이언트가 SERVER_ORIGIN으로 프록시한다. 서버가 중지돼도 클라이언트 화면은 열리고 API 요청에는 502와 SERVER_UNAVAILABLE을 반환한다.
