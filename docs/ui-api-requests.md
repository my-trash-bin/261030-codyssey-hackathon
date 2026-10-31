# UI 분석 연결 뒤 남은 서버 요청

이 문서는 작업 화면이 원자료 파일을 실제 `POST /api/analysis`로 보내 근거와 후보 제안을 표시하는
연결까지 반영한 뒤, 저장·공개 결정·C 필드 선택을 끝내려면 서버 담당자가 제공해야 할 부분을
적는다. 요청을 적었다는 이유로 해당 API나 동작이 구현된 것으로 보지 않는다.

기준 문서는 [F02 분석 계획](f02-analyze-plan.md), [F03 공개 결정 계획](f03-plan.md),
[UI 선행 체크리스트](f03-ui-prerequisites.md), [실제 API](api.md)다. 이 문서는 새 계약 스키마를
만들지 않는다. `contracts/`의 `openapi.json`·`task.v1`·`disclosure_preview.v1`·`decision.v1`은
보존 참고 자료이며 현재 서버의 동작 API가 아니다([참고 계약의 경계](../contracts/README.md)).

## 이번 작업의 연결 범위

- 화면은 목적·수신처와 사용자가 고른 지원 형식 파일(txt/log/md/csv/json, UTF-8)을 읽어 SHA-256과
  canonical base64를 만들고 `POST /api/analysis`를 호출한다. 응답의 evidence와 후보 제안,
  충돌은 내부 검토용 영역에 로컬 바이트 범위·CSV 위치·JSON pointer와 함께 표시한다.
- 응답의 evidence ID·후보 `local_key`는 입력과 제안을 가리키는 임시 참조다. task ID, 영속
  candidate ID, 공개 허가, 공유 초안, 결정 저장이 아니다. 화면은 분석 결과를 공개 결정 영역의
  task 후보로 자동 승격하지 않는다.
- 파일을 고르는 것만으로 전송하지 않는다. 사용자가 목적·수신처·파일을 확인하고, 운영 설정으로
  지정된 분석 모델이 승인된 사내·로컬 분석 환경임을 확인했다는 동의를 직접 체크한 뒤 분석
  버튼을 눌러야 호출한다. 입력 파일·목적·수신처가 바뀌면 동의는 해제된다.
- `GET /api/core`는 현재 `implementation`·`connection`·`ready`만 반환하며 모델 주소나 사내 여부를
  포함하지 않는다. 화면은 실제 호스트가 사내·로컬인지 검증하거나 자동 차단한다고 주장하지
  않는다. 승인 환경 확인은 운영자 확인과 사용자 동의에 의존하며, 이 한계는 아래 관련 요청에 적는다.
- `crypto.subtle`은 localhost 또는 HTTPS의 secure context에서만 쓸 수 있다. 사내 LAN의 HTTP
  주소로 접속하면 화면은 분석 요청을 보내기 전에 보안 문맥이 필요하다는 오류를 표시한다.
  해시를 생략하거나 서버가 대신 계산하는 우회 경로를 만들지 않는다.
- 브라우저 모듈 제공 목록에는 `analysis-state.js`와 `analysis-view.js`를 함께 추가한다. 프록시는
  `POST /api/analysis`에 대해 기존 고정 10초 제한을 적용하지 않고 Engine·ModelClient의 제한된
  호출 예산에 맡기며, 브라우저 취소와 연결 종료를 upstream 중단 신호로 전달한다. 리디렉션은
  계속 `error`로 거부한다. 다른 API의 기존 10초 제한은 유지한다.

### 분석 한도와 오류 표시

- 서버 계약은 source 100개, 개당 256 KiB, 합계 1 MiB, evidence 합계 100개다. 작은 파일이라도
  txt/log/md의 비어 있지 않은 각 줄, CSV의 데이터 셀 등이 근거가 되므로 근거 최대 100개를 넘길
  수 있다. JSON은 scalar와 빈 객체·배열마다 근거를 만들며 값이 든 컨테이너 자체는 만들지 않는다.
  화면은 파일 크기 검사를 통과했다는 사실을 분석 가능으로 표시하지 않고 이 근거 한도를 함께 안내한다.
- `INVALID_CORE_INPUT`은 원인을 구분해 알려주지 않는다. 화면은 특정 원인(형식·인코딩·해시 등)을
  추측해 단정하지 않고 서버가 준 오류 코드와 확인 가능한 입력 상태만 표시한다.
- `MODEL_BUDGET_EXCEEDED`는 파일 크기 한도가 아니라 provider의 현재 `max_input_bytes` 예산 초과다.
  이 값은 예제 설정의 현재 값일 뿐 일반 고정 업로드 한도가 아니다. 별도 상태로 표시하고 자동
  재시도하거나 입력을 임의로 줄여 재전송하지 않는다.
- CSV의 `locator.row`는 헤더를 포함한 1-based 논리 행 번호이므로 첫 데이터 행의 값은 2다. JSON root
  값의 pointer는 빈 문자열이다. 화면은 두 값을 위치 표시에 그대로 쓴다.
- 분석 호출의 기본 시간 제한은 설정의 `provider.request_timeout_seconds`(예시 120초)이고 단계별
  재시도는 `max_attempts_per_step`(예시 2)이다. UI 프록시의 10초 고정 제한으로 정상 분석을
  끊지 않는다.

## 요청 1 — 분석 결과 채택의 HTTP 노출과 task 조회

- 대상: `POST /api/analysis`의 응답을 서버가 task revision과 candidate_set으로 채택(CAS)하고, 이후
  화면이 task 단위로 근거·후보·충돌을 다시 조회하는 경로. 내부 채택은 이미 있고 HTTP만 없다.
- 이미 있는 내부 기능: `RealCore.analyze()`는 형식별 결정적 evidence와 strict 검증된 후보 제안을
  반환한다. `TaskStore.analysis`의 `replaceSources`·`start`·`complete`·`addManual`과
  `runTaskAnalysis`는 source 바이트/hash를 검증해 snapshot을 고정하고, 모델 호출 뒤 evidence와
  영속 candidate ID·서버 conflict group·origin을 저장하며 CAS로 candidate_set에 채택한다.
  재분석·취소·삭제 뒤 늦은 응답은 거부한다. `TaskStore.get`과 `task-schema` 검증도 있다. 이들은
  라이브러리와 내부 저장 기능으로 존재하며, 아래 HTTP 접점이 없다는 것과 구분한다.
- 없는 부분: 위 내부 채택을 노출하는 HTTP 라우트(task 생성·조회, candidate_set·job 상태)가 없다.
  `/api/analysis`는 여전히 stateless여서 저장 경로를 호출하지 않고, 응답에 task·revision·영속
  candidate ID가 실리지 않는다. UI가 임시 분석 결과를 task로 저장하거나 다시 조회하는 동작도 없다.
- 수용 기준:
  - 같은 채택을 HTTP로 두 번 요청해도 candidate_set과 revision이 중복 생성되지 않는다
    (내부 `complete`는 두 번째 호출을 `adopted:false`로 거부한다). revision이 다르면 전체를
    거부하고 부분 채택하지 않는다.
  - 채택 뒤 task 조회로 evidence·후보·충돌·현재 revision을 복원할 수 있고, 그 과정에서 allow
    결정이나 공개 허가가 자동 생성되지 않는다.
  - 분석 결과의 임시 ID와 영속 candidate ID의 대응을 응답에서 확인할 수 있으며, 다른 task의
    ID를 섞으면 거부한다.
  - 저장 실패 시 화면에 표시 중인 분석 결과와 입력을 잃지 않고, 성공으로 표시하지 않는다.
- UI 접속점: 분석 결과 영역은 이번 범위에서 표시 전용이며 저장 버튼을 만들지 않는다. 공개 결정
  영역의 task 조회가 후보 목록을 받는 자리다. 현재 서버에 task HTTP 경로가 없어 404를 작업
  부재로 단정하지 않고 API 제공 여부를 안내한다.

## 요청 2 — 미리보기·조건 해석·결정 배치·철회 HTTP와 세션

- 대상: 후보별 미리보기, D 조건 해석, 결정 배치 적용, 철회를 실제 세션·CSRF 아래에서 제공하는
  HTTP 접점.
- 이미 있는 내부 기능: `TaskStore.preview`는 `fact_summary` 문장을 불변 저장하고 projection hash를
  계산한다. `applyDecisionBatch`는 Idempotency-Key 기반의 원자적·멱등 배치로 revision·preview·
  scope·source hash를 대조하며, `decisions`·`effectiveAllows`·`revoke`·`delete`와 만료 처리가 있다.
  revision 충돌과 잘못된 결정 입력은 내부 오류 코드로 구분된다. `Engine.preview`의 표현 계산과
  `interpret_disclosure` 실행은 아직 없다.
- 없는 부분: 위 기능을 호출하는 HTTP 라우트가 전혀 없다. `/api/v1/session` 성공 응답의 CSRF 토큰
  필드와 획득 방식, 인증·Host/Origin 검사, task·preview·decision·job의 구체 DTO가 확정되지
  않았다. `preview()`는 `fact_summary` 외 표현을 계산하지 못하고, 조건 해석 job도 실행 경로가
  없다. UI는 토큰이 없어 미리보기·적용·철회를 전송 전에 차단한다.
- 수용 기준:
  - 인증된 세션이 CSRF 토큰을 제공하고, 쓰기 요청은 세션·CSRF·Host/Origin·`expected_revision`·
    `Idempotency-Key`를 함께 검사한다.
  - revision 불일치나 preview/scope/hash 불일치 시 배치 전체를 거부하며 부분 저장하지 않는다.
  - revision이 바뀌면 이전 preview는 무효가 되고, 적용은 현재 preview 참조 없이 성공하지 않는다.
  - 철회 뒤 과거 allow로 자동 복귀하지 않으며, 미지원 기능과 존재하지 않는 task의 404를 구분한다.
  - 미리보기·적용·철회의 성공 응답 DTO를 확정하고, UI가 성공을 추정하지 않도록 필요한 상태를
    응답에 포함한다.
- UI 접속점: 공개 결정 영역의 미리보기 요청, 전체 적용 배치, 철회 버튼과 revision 상태 표시.
  분석 결과 영역과는 분리되어 있으며 분석 응답을 결정 배치로 자동 전송하지 않는다.

## 요청 3 — C의 selected_fields 필드 목록·검증·서버 변환

- 대상: C(요청 정보 마스킹)에서 사용자가 남길 필드를 고르고, 서버가 그 필드만으로 실제 공개
  projection을 계산해 미리보기로 돌려주는 경로.
- 이미 있는 내부 기능: 보존된 `contracts/core/shared.schema.json`에는 `select_fields.v1`의
  `parameters.fields: string[]`가 있다. `core-interface`의 `RepresentationKind`에는
  `selected_fields`가 포함되어 있다. `TaskStore`는 `fact_summary` preview를 저장하고 hash를
  계산하며 결정 배치에서 preview 참조·hash를 대조한다. `transforms.ts`에는 B·타임라인·승인
  원문에 해당하는 계산 함수가 있다.
- 없는 부분: HTTP 참고 스키마에는 `fields`와 `select_fields.v1`이 없어 참고 자료끼리 불일치한다.
  후보·원자료에서 선택 가능한 필드 목록을 공급하는 경로, 선택 필드의 존재·중복·형식 검증,
  `selected_fields`와 `exact_value`의 서버 변환·projection 계산, 재사용 불가 강제가 없다. UI에는
  C 필드 선택 화면이 비활성이며 원자료에서 공개 표를 대신 계산하지 않는다.
- 수용 기준:
  - 서버가 해당 후보·원자료에서 실제로 선택 가능한 필드 목록을 제공하고, 목록 밖 필드·중복·
    지원하지 않는 혼합 형식을 전체 거부한다.
  - 선택 필드로 계산한 실제 값과 projection_sha256을 미리보기로 반환하며, UI는 서버가 준 필드와
    값만 렌더링한다.
  - `selected_fields`는 재사용 불가로 처리하고, 적용 저장과 재사용 판단을 혼동하지 않는다.
  - 정의 불일치를 새 계약 파일로 덮지 않고 기존 `select_fields.v1` 정의와 HTTP 스키마를 먼저
    맞춘 뒤 구현한다.
- UI 접속점: 공개 결정 영역의 후보별 C 표현 선택과 필드 선택, 미리보기 표·값 확인. 현재는 비활성
  안내만 있다.

## 관련 요청 — 모델 주소·승인 환경 메타데이터

`GET /api/core`는 모델 주소·provider identity·승인 환경 여부를 제공하지 않으므로 화면이 지정
모델이 사내·로컬인지 확인할 수 없다. 분석 동의 화면은 운영 설정 확인을 전제로 하지만, 실제
호스트 분류를 서버가 제공하거나 확인 출처를 기록하지 않으면 자동 차단을 주장할 수 없다. 모델
주소·분류·확인 시점을 어떤 응답으로 제공할지는 기존 계약에 없는 새 필드이므로 이 문서에서
임의로 확정하지 않고, 인증·설정 노출 경계와 함께 담당자 결정이 필요하다.

## 확인 경계

- 합성 파일과 루프백 모델 응답으로 실제 앱·UI 연결을 확인했다. 실행 명령·관찰 결과·미확인
  경계는 [UI 구현 기준의 분석 연결 실행 확인](UI-구현기준.md#분석-연결-실행-확인)에 기록했다.
- `contracts/openapi.json`의 경로가 문서에 있다는 이유로 현재 서버에 존재한다고 쓰지 않는다.
  현재 실제 라우트는 `/health`, `/api/core`, `/api/documents`, `/api/sharing`, `/api/analysis`다.
- 원본의 외부 AI 전송 금지는 그대로다. [실행 경계](security.md)의 지정 사내·로컬 분석 모델은
  내부 준비 공간이며, 분석 동의는 그 환경 확인에 대한 것이지 외부 AI 전송 승인이 아니다.
  [UI 구현 기준](UI-구현기준.md)의 작성기·공유 초안 경계도 바뀌지 않는다. 실제 LLM·외부 모델을
  호출하지 않았으며 합성 파일과 루프백 응답만 사용했다.

## 구현 접점 확정

이번 서버 연결은 단일 운영자 개발 환경에 한정한다. 명시적으로 설정한 loopback 브라우저 origin과
서버 origin, 운영자 비밀로 세션을 열고 HttpOnly·SameSite 쿠키와 별도 CSRF 토큰을 사용한다.
인증을 설정하지 않으면 v1 API는 비활성이다. 다중 사용자·조직 권한·LAN 운영 인증을 추정하지 않는다.
기존 stateless 분석과 별도로 task 원자료 등록 → 서버 분석 job → CAS 채택 → 집계 조회를 제공한다.
브라우저가 보내는 AnalyzeResult는 채택하지 않는다. 각 쓰기 요청은 멱등 키와 revision을 검사한다.
C는 후보에 연결된 단일 CSV/JSON 근거의 필드만 제공한다. 혼합 소스·비직사각 CSV는 거부한다.
자유 조건 해석은 제안만 반환하며 결정·미리보기·Rule을 생성하지 않는다. 미지원 표현은 명시적으로
거부하고 성공 응답으로 포장하지 않는다. 실제 모델 호출 없이 결정적 회귀 검사로 검증한다.
