# 실제 앱/등록 모델 실행 확인

2026-10-31 UTC. 사용자가 기존 .env의 등록 모델에 가상 데이터를 보내는 테스트를 명시적으로 승인한 뒤 실행했다. 실제 업무 원자료는 사용하지 않았고 모델 주소/ID/키/비공개 설정 값은 기록하지 않는다.

## 실행 방법과 결과

빌드된 `packages/app/dist/main.js`를 실제 별도 프로세스로 시작했다. localhost 임의 포트와 임시 SQLite 경로만 덮어쓰고 나머지는 기존 .env와 config.json으로 구성했다. 테스트 후 프로세스를 종료하고 테스트용 임시 DB를 정리했다. 기존 앱 DB와 비공개 설정은 변경하지 않았다.

| 검사 | 결과 |
| --- | --- |
| GET /health | 200 |
| GET /api/core | real/direct/ready=true |
| POST /api/documents 후 GET 목록 | 201, 가상 문서 한 건 재조회 |
| sources 추가 필드를 보낸 POST /api/sharing | 400, 모델 호출 전 거부 |
| 승인 사실 두 개를 보낸 실제 POST /api/sharing | 200, 약 5.97초, real/direct/ready=true |

입력은 가상 테스트의 응답 대기 timeout 관찰과 서버 처리 완료/원인 미확인이라는 두 사실이다. 최종 결과는 가상 기술지원 문의로 작성됐고, 원인과 처리 완료 여부를 단정하지 않고 미확인으로 유지했다. 이는 이 가상 사례의 실행 확인이며 전체 의미 품질/운영 보관 정책/실자료 사용 검증이 아니다.

## 실행 중 발견하고 수정한 문제

1. 처음 실제 요청은 503이었다. 별도 짧은 가상 연결 진단에서 일반 text 요청은 200, JSON 응답 옵션 요청은 400 unsupported_feature였다. ModelRequest의 JSON 요청이 provider.response_mode=text를 덮어쓰던 코드를 수정했다. text 모드는 response_format을 보내지 않고 프롬프트로 JSON을 요구하며 같은 엄격한 응답 검증을 수행한다. 로컬 HTTP 회귀 시험은 JSON을 원하는 호출도 이 provider 설정을 존중하는지 확인한다.
2. 전송 수정 후에도 검토 모델이 schema_version 없이 result/issues만 반환해 검증에 실패했다. 검토 프롬프트에 필수 루트 키와 완전한 pass JSON 예시를 명시했다. 누락 응답을 허용하도록 파서를 완화하지 않았다. schema_version 누락 거부 회귀 시험을 추가했다.
3. 위 두 수정 후 실제 앱의 동일한 승인 사실 요청이 200으로 완료됐다.

일회성 가상 요청/결과의 상세 로컬 기록은 무시 경로 .local에만 보관했다. 자동 CI는 등록 모델을 호출하지 않고 로컬 목 서버를 사용한다.
