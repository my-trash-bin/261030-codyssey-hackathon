# 3라운드 수동 보안 검토

기준일: 2026-10-31. 전용 `/security-review` 명령은 이 세션에서 제공되지 않아 구현자가 직접 코드/위협 경계/회귀 시험을 검토했다. 독립된 보안 전문가 검토나 운영 배치 인증으로 표시하지 않는다.

## 범위와 수정

| 경계 | 확인/수정 |
| --- | --- |
| 모델 연결 | 지정 endpoint에 native HTTP/TLS로 직접 요청한다. 환경 프록시/전역 fetch dispatcher와 리다이렉트가 인증키 전달 경로를 바꾸지 못한다. provider 응답 원문은 오류 메시지에 복사하지 않는다. |
| 작성 입력 | composeFactPack이 내부 task purpose를 approved_brief로 복사하던 경로를 제거했다. 현재 계약에는 별도 승인 brief가 없어 빈 문자열을 사용한다. 후보 원문/근거/검토 자유 설명도 작성기로 복사하지 않는다. |
| 검토 통과 | 모델 pass만으로 필수 fact 참조 누락을 통과시키지 않도록 결정적 coverage 검사를 추가했다. 이 검사는 주장 의미의 정확성을 증명하지 않으며 의미 검토와 사람 확인은 계속 필요하다. |
| 실행 요청 | 등록 image 전체 ID, target/input digest와 고정 oracle을 대조한다. 임의 인자/파일 경로/shell/모델 생성 코드를 받지 않는다. 등록 이미지와 supervisor 전체가 설치자의 신뢰 경계다. |
| 컨테이너 | network none, non-root, read-only root, capability 제거, no-new-privileges, CPU 1, 메모리와 swap 각 256 MiB, PID 64, tmpfs 32 MiB, 15초 실행 및 stdout/stderr 각 64 KiB 상한을 적용한다. pull/build/host mount/host env/Docker socket 주입은 없다. |
| 파일 관찰 | 고정 supervisor가 종료한 고정 target의 실제 regular file과 제한된 바이트를 읽는다. 호스트는 base64 정규 형태와 예상 바이트를 재대조한다. target의 성공 문자열만으로 성공 처리하지 않는다. |
| 종료/취소 | 생성 전 이름을 기록하고 실패/취소/시간 초과 시 별도 정리 예산으로 force remove한다. 취소 signal을 정리 호출에 재사용하지 않는다. 정리 실패도 오류로 보고한다. |
| 저장 | parameterized SQL과 FK, 동일 task/candidate/preview의 복합 참조, 불변 snapshot/preview/decision trigger를 사용한다. revision/현재 후보/projection hash를 배치 transaction 안에서 확인한다. |
| 공개 권한 | exclude/defer/철회/만료는 allow로 돌아가지 않는다. 분석 채택은 현재 결정 포인터를 비운다. task/decision HTTP API를 추가하지 않아 인증 없는 새 승인 경로를 만들지 않는다. |

## 확인한 증거

- `just check`: QG 규칙, 타입 검사, workspace 빌드, Node 테스트 통과.
- 로컬 목 모델 서버: 앱의 환경 변수 주입부터 `/api/sharing` 작성/검토까지 통과. 리다이렉트 수신 서버에는 요청이 도달하지 않음.
- 로컬 scratch 이미지: 실제 buggy/fixed * ASCII/한글 네 실행의 기대 결과와 출력 바이트 확인. 실제 HostConfig의 격리/자원 제한 확인. 취소 후 컨테이너 조회 실패로 정리 확인.
- 임시 SQLite: 배치 rollback, idempotency, revision 충돌, 다른 작업/후보/미리보기 거부, hash 불일치, 철회/만료, reopen 보존, 기존 documents 보존, task 삭제 cascade 확인.
- 현재 `.env`는 값 노출/네트워크 호출 없이 구성만 확인했고 modelReady=true였다. 실제 사내 모델 응답/품질/보관 정책은 검증하지 않았다.

## 남은 경계

현재 `/api/sharing`은 기존 단일 사용자 개발용 API이며 호출자가 입력 전체를 공개 가능한 내용으로 제공한다. purpose/recipient도 이 좁은 계약의 작성 메타데이터다. 내부 task 저장을 이 API와 연결하지 않았으므로 원자료 목적/내부 표시 이름을 이 경로에 자동 전달하지 않는다. 인증/CSRF/Host/Origin 검사와 전체 승인/최종화 API는 이번 완료 범위가 아니다.

Docker 실행은 검토한 고정 toy binary만 대상으로 한다. 임의 제3자 프로그램/악의적인 등록 이미지/침해된 호스트/daemon 방어를 검증한 것은 아니다. 프로세스 강제 종료/호스트 장애 후의 소유권 ledger 기반 자동 회수는 미구현이며 실행기 안내에 운영 한계를 기록했다. Q-LLM/Q-POLICY/Q-DEPLOY/Q-LICENSE의 실제 운영 값을 대신 채우지 않았다.

Docker flag와 네트워크 의미는 [공식 create 문서](https://docs.docker.com/reference/cli/docker/container/create/), [공식 run 문서](https://docs.docker.com/reference/cli/docker/container/run/)와 대조했다. 실제 호스트의 방화벽/운영 권한/모델 보관 정책은 별도 확인 대상이다.

검토 후 사용자 명시 승인으로 기존 모델에 가상 사실만 보내 실제 앱 왕복을 추가 확인했다. 최초 연결 호환 오류와 검토 형식 오류를 수정한 뒤 HTTP 200이었다. [실제 실행 기록](live-smoke-2026-10-31.md)은 이 추가 확인의 범위와 한계를 구분한다.
