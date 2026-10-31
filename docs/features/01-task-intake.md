# F01 - 작업 생성/목적/수신자/원자료 입력

상태: P0 구현 기준안 / 기준일: 2026-10-31 / 구현 담당: [plan.md](../plan.md)의 F01 담당

## 1. 목적

[PRD-04](../prd.md)의 목적/수신자/자료를 한 작업으로 묶어, 이후 분석과 공개 결정이 **어떤 자료 판본과 공유 범위에 대한 것인지** 식별할 수 있게 한다. 원자료를 올린 사실이 외부 공개 허용이 되지 않아야 한다(INV-03).

이 기능의 완료 지점은 유효한 원자료 집합과 작업 범위를 저장하고 F02가 읽을 수 있게 만드는 곳이다. 후보 분석이나 문서 생성은 수행하지 않는다.

## 2. 쓰는 사람과 권한

| 주체 | 허용 | 금지 |
| --- | --- | --- |
| 현재 로컬 세션 사용자 | 자기 앱의 작업 생성/입력 변경/자료 등록/제외/내부 미리보기 | 유효하지 않은 세션/CSRF 요청, 다른 task 객체를 섞은 참조 |
| F02 분석 실행 | 서버가 고정한 현재 작업 자료를 읽기 | 원본 바이트 수정, 수신자 변경, 공개 승인 |
| 작성 모델 | 이 기능의 원자료 API 접근 없음 | 원자료/전체 파일 목록 조회 |
| 외부 수신자 | 권한 없음 | 작업 목록/원자료/내부 이름 조회 |

단일 사용자 PoC에서도 모든 자료/근거 요청의 task 소속을 서버에서 검사한다. UI에서 버튼을 숨기는 것만으로 권한 처리를 끝내지 않는다. 인증/로컬 접근의 구체 규칙은 [F10](10-runtime-boundary.md)을 따른다.

## 3. 화면과 사용자 동작

UI-02(`/tasks/new`)에서 시작하고 저장한 작업은 UI-03(`/tasks/{id}`)에서 계속한다. UI-01 목록에서 기존 작업을 열어 자료를 추가/교체할 수 있다. 상세 구조는 [IA](../IA.md)의 UI-01~03을 따른다.

1. 내부 작업 이름, 등록 프로젝트, 목적, 이번 목표(goal_variant), 수신자, 공개 범위, 결과 언어, 설치 지침을 선택한다.
2. 파일을 추가하거나 텍스트를 붙여넣는다. 형식/크기/사용 여부를 확인한다.
3. `자료 분석 시작`을 누르면 먼저 현재 입력을 저장한다. 저장이 완료된 revision으로 F02 분석을 요청한다.
4. 업로드가 성공하고 분석 접수가 실패하면 '자료는 저장됨, 분석 시작 실패'로 분리해 보여준다. 파일을 다시 올리지 않고 분석만 재시도한다.

### 빈 화면/실패 화면

| 상태 | 화면 동작 |
| --- | --- |
| 새 작업에 자료 없음 | 형식 안내/붙여넣기 제공, 분석 비활성 |
| 유효한 프로젝트/수신자 없음 | 설정된 항목 선택 또는 UI-09의 운영 설정 안내. 모델이 이름/주소를 추측하지 않음 |
| 지원하지 않는 형식 | 해당 항목에 이유 표시, 제외/변환 후 다시 등록 |
| 배치 중 하나가 잘못됨 | 전체 배치 저장 실패를 표시하고 오류 파일을 수정하게 함 |
| 업로드 크기 초과 | 어떤 제한을 넘었는지 표시, 조용한 자르기 없음 |
| 자료가 모두 제외됨 | `분석할 자료가 없습니다.`. 기존 결과는 stale, 분석/확정 불가 |
| 네트워크 불명확/중복 클릭 | 같은 멱등 키로 결과 조회/재시도. 작업을 중복 생성하지 않음 |
| 오래된 revision | 현재 선택이 바뀌었음을 표시, 입력 보존 후 최신 상태 조회 |

## 4. 데이터: 읽고 쓰는 표/칸

정확한 열/제약은 [ERD](../ERD.md)를 따른다.

| 데이터 | 읽기 | 쓰기 / 제약 |
| --- | --- | --- |
| 로컬 catalog 설정 | 등록 ID/표시 이름/범위/설정 digest | 앱 UI에서 쓰지 않음. 운영자가 설정 변경/검증/재시작. 기존 ID 의미를 다른 주체로 바꾸지 않음 |
| tasks | 현재 revision/phase/scope/포인터 | internal_title, project_id, purpose_id, goal_variant, recipient_id, audience, output_language, skill_ids, revision, phase |
| task_snapshots | 현재 입력 범위 | 수신 범위/자료 집합/지침 판본의 불변 스냅샷 |
| source_versions | 기존 source_id/버전 | 원본 raw_bytes, sha256, format, display_name, source_slot, parser_version; 변경은 새 version |
| task_sources | 현재 사용 자료 | current_source_version_id, included. 제외는 원자료 바이트 수정이 아님 |
| jobs / artifacts / exports | 이전 실행/현재 결과 | 입력 변경에 따른 취소 요청/stale 표시/현재 결과 무효화 |
| events / idempotency_keys | 중복 요청/현재 이벤트 순서 | 상태 변경 이벤트와 응답 기록을 같은 트랜잭션에서 저장 |

원자료의 파일명/내부 작업 이름/수신자 표시 이름은 공개 데이터가 아니다. F02와 내부 UI는 필요한 범위에서 읽지만 F04 작성 입력에 그대로 복사하지 않는다.

## 5. 입력/상태/동시성 규칙

### 입력 계약

- 목적은 `oss_issue`, `vendor_support`, `operations_advice`다.
- goal_variant는 `default`, `observations_only`, `ask_for_diagnostics`, `reproduction_evidence`다. OSS는 default/observations_only/reproduction_evidence, 공급사 문의는 default/observations_only/ask_for_diagnostics와 실행 팩이 있는 경우 reproduction_evidence, 운영 자문은 default만 허용한다.
- audience는 `public` 또는 `named_external`이다. public 수신자와 지정 수신자의 조합을 서버에서 검증한다.
- 출력 언어는 PoC 기본 `ko`/`en`이다. 다른 값은 명시적 지원 없이 통과시키지 않는다.
- 자료는 UTF-8 `.txt/.log/.md/.csv/.json`과 붙여넣기를 지원한다. 파일 형식과 내용 파싱 결과를 모두 확인한다.
- PoC 기본 제한은 작업당 현재 자료 10개, 파일당 262,144바이트, 현재 자료 합계 1,048,576바이트다. 모델 문맥 제한은 별도다. 조정값의 권위는 [spec](../spec.md)의 limits다.
- 원본의 UTF-8 바이트를 보존한다. 저장 전에 줄바꿈/Unicode 정규화/내용 치환을 하지 않는다. UTF-8 BOM 처리가 필요한 파서도 원본은 그대로 둔다.
- JSON의 중복 키/알 수 없는 계약 키/후행 JSON은 해당 구조 계약에 따라 거부한다. 일반 자료 JSON 자체의 키 집합과 제품 계약의 키 집합을 혼동하지 않는다.
- CSV는 중복 헤더/행 열 개수 오류를 표시한다. 잘못된 행을 조용히 버리지 않는다. 등록 스키마 `requests_v1`은 `observed_at,count`, source_slot은 `request_summary`이며 count는 0 이상의 정수다. 시각/단위가 읽혔다고 공개 허용되는 것은 아니다.
- 붙여넣은 내용은 명시적인 파일 항목으로 저장한다. 빈 텍스트만으로 분석을 시작하지 않는다.
- 같은 파일 표시 이름은 허용하고 source_id로 구분한다. 같은 내용 재첨부를 기존 자료 교체로 추정하지 않는다. 교체는 replace_source_id가 지정된 경우만 수행한다.
- 파일 표시 이름은 UI용이다. 사용자 문자열을 서버 파일 경로나 공개 파일 경로로 사용하지 않는다.

### 원자성과 판본

| 동작 | 결과 |
| --- | --- |
| 작업 생성 | revision 1, `needs_analysis`, 원자료 0개 허용 |
| 한 배치의 자료 추가/교체 | 모든 항목 검증 성공 시 한 트랜잭션, revision +1, `needs_analysis` |
| 한 항목 검증 실패 | 배치의 자료/포인터/revision 모두 변경 없음 |
| 현재 자료 제외 | included=false와 revision +1, 기존 결과 stale, `needs_analysis` |
| purpose 또는 goal_variant 변경 | revision +1, 현재 분석/결정 결과를 재사용하지 않고 재분석 |
| recipient/audience 변경 | revision +1, 기존 공유 허용은 새 범위에서 미유효, 결정 재확인 |
| 언어/지침 변경 | revision +1, 결과 stale. 지침 변경의 재분석 여부는 공통 전이표에 따름 |
| 내부 작업 이름만 변경 | 보수적으로 revision +1, 이전 결과 stale. 사용자에게 재확인 필요 안내 |
| 원문 같은 위치의 새 파일 교체 | 새 source_version. 이전 exact/raw 허용 자동 이전 불가 |

상태의 최종 적용은 [spec](../spec.md)의 전이표가 결정한다. 이전 job 취소가 늦어져도 CAS가 오래된 결과 적용을 차단한다. 사용자 입력 저장은 이전 모델 호출 종료를 기다리지 않는다.

### 멱등/경쟁

모든 변경 요청은 Idempotency-Key와 필요한 expected_revision을 사용한다. 같은 요청을 같은 키로 재전송하면 원래 결과를 반환한다. 다른 본문에 같은 키를 쓰면 409다. source-batches를 포함한 배치의 변경은 한 번만 적용된다. 여러 창의 오래된 요청은 최신 값을 덮어쓰지 않는다.

## 6. 다른 기능과 닿는 곳

REST 경로와 DTO의 최종 정의는 [api.md](../api.md)다. 논리 서비스 이름은 아래와 같이 고정한다.

| 서비스 / API | 입력 | 반환 / 다음 기능 |
| --- | --- | --- |
| `TaskService.CreateTask` / `POST /api/v1/tasks` | internal_title, project_id, purpose_id, goal_variant, recipient_id, audience, output_language, skill_ids | task_id, revision, phase -> F02/UI |
| `TaskService.UpdateTask` / `PATCH /api/v1/tasks/{id}` | expected_revision과 명시적으로 수정하는 metadata/scope | 최신 revision, phase, 허용 action, 무효화 요약 |
| `SourceService.AddSourceBatch` / `POST /api/v1/tasks/{id}/source-batches` | multipart `meta`: expected_revision, items(client_key, display_name, format, source_slot, replace_source_id); 파일 필드 이름은 client_key | source_versions, current_revision, invalidated_artifact_ids, phase |
| `SourceService.ExcludeSource` / `DELETE /api/v1/tasks/{id}/sources/{source_id}` | expected_revision | 최신 입력 집합, phase |
| 내부 자료 조회 / `GET /api/v1/tasks/{id}/sources/{source_version_id}` | 현재 인증 세션, task/source 소속 | 내부 미리보기/판본/원본 해시 |
| catalog 조회 / `GET /api/v1/catalog` | 현재 인증 세션 | 설정에 등록된 프로젝트/목적/수신자/지침/공개 양식. 추가는 운영 설정 변경과 재시작 |

F02는 앱이 지정한 불변 source_version_id와 실제 바이트로 분석한다. F03는 해당 판본의 근거를 기반으로 결정한다. F04에는 원자료를 직접 넘기지 않는다. F09의 작업 삭제는 현재 입력에서 제외하는 동작과 다르다.

## 7. 하지 않을 것

PDF/DOCX/이미지/OCR/ZIP 자동 해제, URL 크롤링, 외부 저장소 자동 가져오기, 임의 로컬 경로 읽기, 다중 사용자 프로젝트 권한, 원자료 자동 공개, 업로드 내용을 자동 실행하는 기능은 없다. 파일 형식만 바꾸어 허용되지 않은 내용을 우회 실행할 수 있게 하지 않는다.

## 8. 끝났다는 기준

| ID | 분류 | 실행과 기대 결과 |
| --- | --- | --- |
| AC-F01-01 | 정상 | 목적/수신자/TXT/CSV/JSON을 저장하면 API와 새로고침 화면에서 같은 task/source 판본 확인 |
| AC-F01-02 | 정상 | 자료 추가/교체/제외가 각각 불변 과거 판본과 새 현재 집합을 유지하고 revision을 한 번 올림 |
| AC-F01-03 | 경계 | 파일 수/파일/합계 바이트 한도 정확히 이하는 허용, 1개/1바이트 초과는 배치 변경 없이 거부 |
| AC-F01-04 | 오류 | 깨진 UTF-8/JSON/CSV 또는 잘못된 파일이 한 배치에 있으면 전체 배치 미반영, 오류 항목 표시 |
| AC-F01-05 | 동시성 | 동일 멱등 요청은 한 번만 적용, 다른 요청의 키 충돌과 오래된 revision은 409 |
| AC-F01-06 | 권한 | 비인증 요청/다른 task의 source ID/위조 CSRF는 원자료를 읽거나 바꾸지 못함 |
| AC-F01-07 | 경계 | 파일명이 경로/HTML/제어문자를 포함해도 서버 경로로 사용하거나 코드로 실행하지 않음 |
| AC-F01-08 | 상태 | 수신자/자료 변경 직후 이전 결과의 복사/확정 불가, 늦은 job이 현재 결과를 덮어쓰지 않음 |
| AC-F01-09 | 복구 | 자료 저장 후 모델 접수 실패 시 입력은 남고 분석만 재시도 가능 |
| AC-F01-10 | 의미 | 원자료 업로드/프로젝트 이름/내부 메모가 공개결정이나 작성기 공개 입력으로 자동 포함되지 않음 |

대응 시험은 [qa.md](../qa.md)의 T10, T19, T25-26, T28-29, T43, T58이다.

## 9. 확인 필요와 구현 순서

실제 사내 수신자/반출 승인 조건은 Q-POLICY, 입력 자료의 실제 형식/제품 정보는 Q-EXT, 저장 위치/보존 운영은 Q-DEPLOY에서 확인한다. 가상 자료 개발은 이 정보 없이 시작한다.

구현 순서는 검증된 catalog 읽기/task 저장 -> strict 파서와 원본 판본 -> 원자적 source batch -> 범위 변경 무효화 -> UI 입력/실패 상태 -> F02 연결이다. 입력/판본 규칙을 바꾸면 spec/ERD/API/F02/F03/F09와 해당 시험을 함께 변경한다.
