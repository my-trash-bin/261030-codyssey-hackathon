# UI 분석/공개 결정 연결 요청 현황

서버 요청 1~3의 연결 접점이 구현됐고, 화면도 그중 일부를 실제로 호출한다. 실제 경로/인증/환경
변수/DTO는 [실제 API](api.md)의 "인증된 task/공개 결정 API"를 정본으로 삼는다. 이 문서는 서버 경로와
화면 연결을 구분해 남은 화면 작업과 지원 한도를 기록한다. `contracts/`는 보존 참고 계약이며 현재 API
전체를 대신하지 않는다([계약 경계](../contracts/README.md)).

## 서버 경로와 화면 연결

| 요청 | 서버 | 화면 |
| --- | --- | --- |
| 1. 분석 채택/task 조회 | task 생성/조회/삭제, 원자료 snapshot 교체, 분석 job 시작/조회/취소, 서버 ID/CAS 채택, 모델 없는 수동 후보 | `useTaskFlow`가 `createTask` -> `replaceSources` -> `startAnalysis` -> `readAnalysisJob`과 취소를 호출. 수동 후보 입력 화면은 없음 |
| 2. 미리보기/결정/세션 | 운영자 세션/CSRF/Host/Origin, 로그아웃, 불변 미리보기, 원자적/멱등 결정 배치, 철회, 조건 해석 제안 job | `useSession`이 복원/열기를 하고 `App`이 CSRF 토큰을 `useDisclosures`에 전달. 로그아웃과 만료 재확인은 미연결 |
| 3. C 필드/변환 | 단일 CSV/JSON 후보의 검증된 근거 필드 목록, 실제 선택 값/projection hash, 미등록/중복/불완전 셀 거부 | 화면 입력 비활성 |
| 4. 재사용 규칙(F06) | 결정 배치의 `save_reusable_rule`과 규칙 목록/판본/철회/적용 경로 | 재사용 체크박스만 있고 규칙 목록/적용/철회 화면은 없음 |
| 관련: 모델 환경 메타데이터 | 인증된 세션에서 설정 provider origin만 제공. 키/경로/query/URL 자격 증명 제외. 운영자 확인 필요 상태를 명시 | 세션 안내 문구로만 표시 |

분석은 등록한 task snapshot으로 서버가 다시 실행한다. 브라우저가 보낸 AnalyzeResult를 신뢰해
채택하는 라우트는 없다. 기존 stateless `/api/analysis`의 임시 evidence/local_key는 계속 영속
ID나 공개 허가가 아니다. 영속 채택 결과는 task candidates의 local_key->id 대응으로 확인한다.
같은 쓰기 경로/멱등 키/본문의 재시도는 같은 결과를 반환한다. 다른 본문/판본은 전체 거부한다.
취소/재분석/원자료 변경/삭제 뒤 늦은 응답은 채택되지 않는다.

미리보기와 조건 해석은 결정 저장과 분리돼 있다. 모델이 제안한 필드도 실제 preview에서 원자료/
근거/필드 검증을 다시 거친다. apply는 현재 preview의 representation/hash/revision/source/
scope를 대조한다. 철회 후 과거 allow로 복귀하지 않는다. 미리보기와 조건 해석 경로 자체는 규칙을
만들지 않으며, 규칙은 결정 배치의 `save_reusable_rule`이나 규칙 API로만 생성된다.

인증은 명시적으로 켜는 HTTP loopback/단일 운영자 개발 경계다. 세션이 없으면 조회도 거부하며,
쓰기에는 CSRF/Origin/Host/멱등 키와 task 판본을 검사한다. LAN/회사 인증/다중 사용자 권한을
완료한 것으로 해석하지 않는다. 실제 모델 주소가 사내인지 자동 승인하거나 보증하지 않는다.
인증 경계를 끈 서버(fake-app, workflow 미설정)는 세션 없이 기존 `/api/analysis`와
`/api/documents`를 그대로 제공한다.

## 남은 UI 연결

<!-- // TODO: UI-API-01 세션 로그아웃과 만료 뒤 재확인 UX를 연결한다. -->
세션 복원(`GET /api/v1/session`)과 열기(`POST /api/v1/session`)는 `useSession`이 호출하고, 받은
CSRF 토큰은 `App`의 상태를 거쳐 `useDisclosures`와 `useTaskFlow`의 쓰기 헤더로 전달된다. 토큰은
메모리에만 두고 코드나 localStorage에 넣지 않는다. 남은 것은 로그아웃(`DELETE /api/v1/session`)과
만료 뒤 재확인 경로다. API가 비활성이면 WORKFLOW_API_DISABLED, 미인증이면 AUTH_REQUIRED로
안내한다.

<!-- // TODO: UI-API-02 수동 후보 입력과 catalog 기반 작업 등록 화면을 연결한다. -->
task 생성/원자료 등록/분석 job의 시작, 조회, 취소는 `useTaskFlow`가 실제 서버로 호출한다. 서버 job
성공과 task 조회에서 받은 영속 ID만 공개 결정 영역에 전달하고, 네트워크 실패/409/취소를 저장
성공으로 표시하지 않는다. 화면은 아직 `context`(목적, 수신처)만 보내므로 catalog의 프로젝트와
수신자, 양식을 고르는 `intake` 폼, 수동 후보 입력, 원자료 개별 삭제가 남아 있다.

<!-- // TODO: UI-API-03 C의 서버 필드 목록/필드 선택/재조회와 실제 preview를 연결한다. -->
C의 화면 입력은 지금도 비활성이다. 필드 목록 API의 input_revision에 묶어 선택하고
select_fields.v1 parameters.fields로 요청한다. JSON root의 빈 pointer, CSV 논리 행 번호,
빈 셀을 보존한다. 선택 값은 브라우저에서 재계산하지 않고 서버 projection만 렌더한다.

<!-- // TODO: UI-API-04 지원 표현의 규칙 저장과 규칙 목록/적용/철회 화면을 연결한다. -->
세션 응답의 capabilities.reusable_rules는 true이므로 false를 전제로 쓰기 버튼을 막지 않는다.
규칙은 csv 셀 계열 후보의 `derived_table` 표현(`series_direction_only.v1`,
`series_index_base100.v1`)만 저장되며, 정확한 값과 승인 발췌, 선택 필드 표현은 클라이언트의
`REUSABLE_FORBIDDEN`과 서버 검증이 함께 거부한다. catalog 범위가 없는 작업은
RULE_SCOPE_REQUIRED, 그 밖의 미지원 표현은 RULE_NOT_REUSABLE 422로 거부된다. 화면은 배치 본문에
`save_reusable_rule`만 싣고, 규칙 목록(`GET /api/v1/rules`), 새 판본, 철회, 재적용
(`POST /api/v1/tasks/{id}/rules/apply`) 화면은 아직 없다. 성공 뒤에는 task를 재조회한다.

<!-- // TODO: UI-API-05 인증된 환경 메타데이터를 분석 동의 화면에 연결한다. -->
provider_origin은 설정 위치일 뿐 승인 판정이 아니다. approval_status는 항상
operator_confirmation_required, verified_at은 null이다. 운영자가 승인 환경을 확인하기 전
자동 확인 완료로 표시하지 않는다. 기존 사용자 동의도 외부 AI 반출 승인이 아니다.

## 지원 한도와 별도 범위

- A는 현재 후보 문장의 미리보기다. 구체적인 값을 자동으로 제거했다는 보장은 하지 않는다.
  사람이 미리보기 내용을 보고 승인한다. B와 인덱스 변환은 단일 CSV 숫자 열의 근거만 지원한다.
- C는 단일 CSV/JSON의 후보 연결 근거만 지원한다. 혼합 소스/존재하지 않는 필드/중복 필드와
  선택한 CSV 열의 빠진 셀은 거부한다. exact_value는 단일 CSV/JSON 근거 값만 지원한다.
- D는 bounded disclosure 모델의 제안이다. supported도 허가가 아니며 preview 검증이 별도로
  필요하다. 모호하거나 지원하지 않는 제안은 자동 허용하지 않는다.
- approved_excerpt와 타임라인 표현은 미지원이다. 세션 capabilities도 approved_excerpt를
  false로 알리고, 표현 검증을 통과하지 못한 요청은 결정으로 저장되지 않는다.
- 초안 작성/검토 job, 아티팩트 편집과 사람 검토, 확정과 내보내기, 규칙 목록/판본/철회/적용,
  작업 목록과 이벤트, `/api/v1/runtime`은 서버에 구현돼 있고 화면만 연결되지 않았다. 이 경로들을
  미지원 기능으로 단정하지 않는다. 실제로 지원하지 않는 표현과 기능만 거부된다.
- 원자료의 source 100개/개당 256 KiB/합계 1 MiB/근거 100개와 모델 입력/retry 예산은 유지한다.
  브라우저 해시는 secure context가 필요하고, INVALID_CORE_INPUT의 원인을 추측하지 않는다.
  MODEL_BUDGET_EXCEEDED는 업로드 크기와 다른 provider 예산 오류다.
- stateless 분석 프록시는 기존 10초 제한을 적용하지 않는다. task 분석/D는 빠른 202 job 응답 후
  GET으로 조회하므로 기존 프록시 제한 안에서 모델 대기를 분리한다. 쿠키/CSRF/Origin을 전달한다.

## 검증 근거

새 결정적 회귀는 `packages/core/src/disclosure.test.ts`,
`packages/server/src/workflow-http.test.ts`, `packages/app/src/workflow.test.ts`에 있다.
합성 CSV/JSON과 주입한 fixture 모델로 파싱->서버 채택->C 변환->사람 결정 저장을 실제 loopback
HTTP에서 확인한다. 중복/판본 충돌/원자성/권한/취소 후 늦은 응답/철회도 검사한다.
모델 문장 품질은 회귀 판정에 쓰지 않는다. 외부 모델/실자료/Docker/macOS 녹화는 실행하지 않았다.
기존 UI 분석 실행 기록은 [UI 구현 기준](UI-구현기준.md)의 당시 기록으로 구분한다.

이 문서를 쓴 시점에 합성 loopback API에 연결한 Playwright Chromium에서 분리된 UI 모듈/CSS 로드,
공개 결정 영역 렌더, 런타임 오류 없음을 확인했다. 호스트의 sandbox 제약 때문에 그 브라우저
검증에서만 --no-sandbox를 사용했고 제품 실행 옵션은 바꾸지 않았다. 이 검증은 세션 로그아웃, C 선택,
수동 후보, 규칙 목록 화면의 연결을 확인한 것이 아니다.
