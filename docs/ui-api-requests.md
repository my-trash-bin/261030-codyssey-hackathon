# UI 분석/공개 결정 연결 요청 현황

서버 요청 1~3의 연결 접점을 구현했다. 실제 경로/인증/환경 변수/DTO는 [실제 API](api.md)의
"인증된 task/공개 결정 API"를 정본으로 삼는다. 이 문서는 남은 화면 작업과 지원 한도를 기록한다.
`contracts/`는 보존 참고 계약이며 현재 API 전체를 대신하지 않는다([계약 경계](../contracts/README.md)).

## 완료한 서버 작업

| 요청 | 구현/검증한 범위 |
| --- | --- |
| 1. 분석 채택/task 조회 | task 생성/조회/삭제, 원자료 snapshot 교체, 분석 job 시작/조회/취소, 서버 ID/CAS 채택, 모델 없는 수동 후보 |
| 2. 미리보기/결정/세션 | 운영자 세션/CSRF/Host/Origin, 불변 미리보기, 원자적/멱등 결정 배치, 철회, 조건 해석 제안 job |
| 3. C 필드/변환 | 단일 CSV/JSON 후보의 검증된 근거 필드 목록, 실제 선택 값/projection hash, 미등록/중복/불완전 셀 거부, 재사용 저장 거부 |
| 관련: 모델 환경 메타데이터 | 인증된 세션에서 설정 provider origin만 제공. 키/경로/query/URL 자격 증명 제외. 운영자 확인 필요 상태를 명시 |

분석은 등록한 task snapshot으로 서버가 다시 실행한다. 브라우저가 보낸 AnalyzeResult를 신뢰해
채택하는 라우트는 없다. 기존 stateless `/api/analysis`의 임시 evidence/local_key는 계속 영속
ID나 공개 허가가 아니다. 영속 채택 결과는 task candidates의 local_key->id 대응으로 확인한다.
같은 쓰기 경로/멱등 키/본문의 재시도는 같은 결과를 반환한다. 다른 본문/판본은 전체 거부한다.
취소/재분석/원자료 변경/삭제 뒤 늦은 응답은 채택되지 않는다.

미리보기와 조건 해석은 결정 저장과 분리돼 있다. 모델이 제안한 필드도 실제 preview에서 원자료/
근거/필드 검증을 다시 거친다. apply는 현재 preview의 representation/hash/revision/source/
scope를 대조한다. 철회 후 과거 allow로 복귀하지 않는다. Rule이나 작성기 승인은 생성하지 않는다.

인증은 명시적으로 켜는 HTTP loopback/단일 운영자 개발 경계다. 세션이 없으면 조회도 거부하며,
쓰기에는 CSRF/Origin/Host/멱등 키와 task 판본을 검사한다. LAN/회사 인증/다중 사용자 권한을
완료한 것으로 해석하지 않는다. 실제 모델 주소가 사내인지 자동 승인하거나 보증하지 않는다.

## 남은 UI 연결

<!-- // TODO: UI-API-01 세션 로그인/복원/만료 UX를 연결하고 csrf_token을 DisclosureWorkspace에 전달한다. -->
현재 운영 mount는 토큰을 받지 않아 공개 결정 쓰기를 차단한다. POST/GET `/api/v1/session`의
실제 계약은 확정됐지만, 세션 성공을 가정하거나 비밀을 코드/localStorage에 넣지 않는다.
API가 비활성이면 WORKFLOW_API_DISABLED, 미인증이면 AUTH_REQUIRED로 안내해야 한다.

<!-- // TODO: UI-API-02 task 생성/원자료 등록/영속 분석 job/조회/취소/수동 후보 화면을 연결한다. -->
현재 파일 분석 영역은 stateless 결과 표시용이다. 분석 결과와 입력을 그대로 보존하고 새 task
생성/원자료 등록/서버 분석을 명시적으로 수행한다. 서버 job 성공/task 조회에서 받은 영속 ID만
공개 결정 영역에 전달한다. 네트워크 실패/409/취소를 저장 성공으로 표시하지 않는다.

<!-- // TODO: UI-API-03 C의 서버 필드 목록/필드 선택/재조회와 실제 preview를 연결한다. -->
C의 화면 입력은 아직 비활성이다. 필드 목록 API의 input_revision에 묶어 선택하고
select_fields.v1 parameters.fields로 요청한다. JSON root의 빈 pointer, CSV 논리 행 번호,
빈 셀을 보존한다. 선택 값은 브라우저에서 재계산하지 않고 서버 projection만 렌더한다.
DTO 파서는 fields 문자열 배열을 수용하도록 수정했다.

<!-- // TODO: UI-API-04 공개 결정 화면에 capability/미지원 표현/Rule 저장 차단을 반영한다. -->
기존 후보별 미리보기/조건 해석/배치/철회 요청 경로는 실제 서버와 맞췄다. 세션 연결 후에도
capabilities.reusable_rules=false를 적용해야 한다. C/정확한 값/원문의 재사용 저장은 항상 거부하며,
현재 서버는 나머지 표현도 save_reusable_rule=true를 거부한다. 성공 뒤에는 task를 재조회한다.

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
- approved_excerpt/타임라인 표현/F06 Rule 저장/매칭/공유 초안과 최종화 연결은 별도다.
  미지원 기능은 422로 거부한다. 서버 완료와 제품 전체 흐름 완료를 구분한다.
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

전체 `mise exec -- just check`가 통과했다. 합성 loopback API에 연결한 Playwright Chromium에서
분리된 UI 모듈/CSS 로드, 공개 결정 영역 렌더, 런타임 오류 없음을 확인했다. 호스트의 sandbox
제약 때문에 이 브라우저 검증에서만 --no-sandbox를 사용했고 제품 실행 옵션은 바꾸지 않았다.
이는 화면의 영속 task 로그인/C 선택 연결을 완료했다는 뜻은 아니다.
