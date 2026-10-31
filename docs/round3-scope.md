# 3라운드 구현 범위

## 코딩 전 범위 축소

기존 문서 저장 API와 전체 제품 설계 사이에 내부 저장 계층만 먼저 추가한다. 이 계획을 기록한 뒤 구현한다. intent.md의 목적과 공개 결정 권한은 변경하지 않는다.

- 모델 연결: 앱 조립부가 공개 기본 provider/workflow 설정과 기존 환경 변수를 읽고 ModelClient를 주입한다. 설정이 없으면 ready=false이며 실제 호출은 사용자 재생성 요청 때만 한다. 비공개 config.json은 변경하지 않는다.
- Docker: 등록된 digest 고정 toy 이미지와 등록된 합성 입력만 실행한다. 임의 코드·명령·파일·원문은 요청에 받지 않는다. 런타임 pull/build 없이 network none, non-root, read-only, capability 제거, no-new-privileges, CPU/메모리/PID/tmpfs/시간/출력 제한을 적용한다. 실제 출력 파일 검사는 이미지에 함께 고정한 supervisor가 수행하고 호스트 판정기가 바이트를 재대조한다.
- 저장: 기존 SQLite에 별도 버전 테이블을 사용하는 추가 migration을 적용한다. tasks, candidate_sets/candidates, disclosure_previews, decisions/current_decisions, task_snapshots만 내부 서비스로 제공한다. 기존 documents 데이터는 보존한다.
- 결정: 사람의 호출 경로에 한해 현재 revision·후보 소속·미리보기·projection hash를 검사한 원자적 배치, 철회, 만료, 현재 포인터와 과거 허용으로 복귀하지 않는 동작을 시험한다. 이번 구현은 fact_summary만 허용한다. raw/exact/selected_fields/변환·재사용 규칙은 지원하지 않는다.
- HTTP task/decision API는 인증·CSRF·Host/Origin 검사가 아직 없으므로 이번에 노출하지 않는다. 전체 task.v1, jobs/artifacts/exports, 분석 모델 연결과 UI는 별도 구현이다. 새 저장 계층이 공개 승인 API의 완성을 뜻하지 않는다.

## 검증

모델은 로컬 HTTP 목 서버, Docker는 CLI 경계 테스트와 opt-in 실제 이미지 실행, 저장은 임시 SQLite의 재열기·rollback·소속·revision·철회·만료·migration 보존 시험으로 확인한다. 실제 Docker 환경이 없으면 실컨테이너 검증을 미수행으로 보고한다. 전용 /security-review 명령은 현재 세션에 없어 수동 코드 검토와 보안 회귀 시험 결과를 별도 문서로 남긴다.
