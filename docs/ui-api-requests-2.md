# 공개 결정 이후 남은 서버 요청

이 문서는 [1편](ui-api-requests.md)이 요청한 분석 채택·task 조회·미리보기·결정 배치·세션이 열린
뒤에도 작업 화면에서 끝낼 수 없는 흐름을 적는다. 대상은 작업 생성과 원자료 등록(전제), 초안
작성·검토(F04), 최종 파일·확정·내보내기(F05), 재사용 규칙(F06), 이력·취소·삭제(UI-07),
실행 환경 조회(UI-09)다. 요청을 적었다는 이유로 해당 API나 동작이 구현된 것으로 보지 않는다.

기준 문서는 [작업 등록 계획](features/01-task-intake.md), [작성·검토 계획](features/04-compose-review.md),
[최종 확인·내보내기 계획](features/05-export.md), [재사용 규칙 계획](features/06-decision-reuse.md),
[이력·복구 계획](features/09-history-recovery.md), [실행 경계](features/10-runtime-boundary.md),
[화면 구조](IA.md), [동작 명세](spec.md)다. 현재 동작 API는 [실제 API](api.md)가 정본이다.

이 문서는 새 계약 스키마를 만들지 않는다. `contracts/`의 `openapi.json`·`schema.sql`·`task.v1`은
보존 참고 자료이며 현재 서버의 동작 API·DDL이 아니다([참고 계약의 경계](../contracts/README.md)).
아래 "이미 있는 내부 기능"은 라이브러리·저장 함수로 존재한다는 뜻이고, 그것이 HTTP나 화면에
연결됐다는 뜻이 아니다.

> 이 문서를 쓴 뒤 원격 main의 `feat: expose authenticated task and disclosure workflow APIs`가
> 병합됐다(로컬 `53afbf1`). 그 커밋이 1편 요청과 이 문서 요청 0·1·5의 일부를 구현했으므로, 각
> 요청을 읽기 전에 아래 `병합 뒤 상태`를 먼저 본다.

## 병합 뒤 상태

| 영역 | 요청 | 병합 뒤 서버 | 남은 것 |
| --- | --- | --- | --- |
| 세션·CSRF | 요청 0 | 구현됨. `POST`·`GET /api/v1/session`, `Path=/api/v1` 쿠키(`docs/api.md` `:125-129`) | 화면이 토큰을 받지 않아 쓰기는 여전히 차단 |
| 작업 생성·원자료 | 요청 1 | 생성·조회·`PUT /tasks/{id}/sources` 구현(`docs/api.md` `:150-152`) | catalog·자료 삭제·자료 한도 결정 |
| 미리보기·결정(1편) | 1편 요청 2·3 | previews·fields·decision-batches·revoke·해석 job 구현(`docs/api.md` `:157-162`) | 실제 모델 입력으로 A~D 확인 |
| 초안 작성·검토 | 요청 2 | 미구현 | job·artifact 저장·렌더·사람 검토 |
| 최종 파일·확정·내보내기 | 요청 3 | 미구현 | 전부 |
| 재사용 규칙 | 요청 4 | 미구현. `save_reusable_rule`은 422 `RULE_REUSE_NOT_IMPLEMENTED`(`packages/server/src/workflow-http.ts:196`) | 전부 |
| 이력·취소·삭제 | 요청 5 | 부분. task 삭제·job 취소·job 조회(`docs/api.md` `:155`, `:163`) | 목록·이벤트·삭제 확인 문자열 |
| 실행 환경 | 요청 6 | 부분. 세션 응답의 `analysis_environment`·`capabilities`(`workflow-http.ts:64-66`) | `/api/v1/runtime`·앱 버전·디버그 정책 |

화면은 아직 세션을 호출하지 않는다. `packages/client/src/main.ts:39`는 공개 결정 영역을 토큰 없이
마운트하고, 클라이언트는 "운영 화면에 인증된 세션의 CSRF 토큰이 제공되지 않았습니다"라는 사유로
쓰기를 막는다(`packages/client/src/disclosure-contract.ts:502-504`). 서버 구현과 화면 연결 사이에
남은 간격이 이것이다.

## 작성 시점 상태

| 영역 | 이 문서의 요청 | 이미 있는 내부 기능 | HTTP 라우트 | 화면 |
| --- | --- | --- | --- | --- |
| 세션·CSRF | 요청 0 | 없음 | 없음 | 모든 쓰기 버튼이 전송 전 차단 |
| 작업 생성·원자료 등록 | 요청 1 | `TaskStore.create`, `AnalysisStore.replaceSources` | 없음 | 입력 폼 자체가 없음 |
| 초안 작성·검토 | 요청 2 | `composeFactPack`, `RealCore.write/review/writeReviewed`, `validateDraft`, `groundFacts` | 없음 | `공유 초안 생성` 비활성 |
| 최종 파일·확정·내보내기 | 요청 3 | 없음 | 없음 | `최종 파일 확인` 비활성 |
| 재사용 규칙 | 요청 4 | 규칙 검증(`groundFacts`)만, 저장·매칭 없음 | 없음 | 체크박스만 있고 저장 불가 |
| 이력·취소·삭제 | 요청 5 | `TaskStore.delete`, `AnalysisStore.cancel`(부분) | 없음 | 화면 없음 |
| 실행 환경 | 요청 6 | `CoreInfo` 3필드 | `/api/core`만 | 일부 표시 |
| A·B·D 미리보기 엔진 | 관련 요청 | 변환 함수만(`transforms.ts`), `Engine.preview`·`interpret`는 미구현 | 없음 | 미리보기 비활성 |

작성 시점에는 실제 라우트가 `GET /api/core`, `POST /api/sharing`, `POST /api/analysis`,
`GET /health`, `GET|POST /api/documents` 여섯 개뿐이었고 `/api/v1/*`는 404였다
(`packages/server/src/app.ts:39`, `:75`). 병합 뒤에는 `/api/v1/*`를 워크플로 핸들러로 넘기며
경로·필드 정본은 `docs/api.md` `:112-163`이다.

## 1편과 겹치는 항목

1편의 요청은 병합된 원격 main에서 대부분 구현됐다. 그래서 이 문서는 세션·작업 생성·미리보기·결정
엔드포인트를 다시 요청하지 않는다.

| 항목 | 1편의 위치 | 병합 뒤 상태 |
| --- | --- | --- |
| 세션·CSRF | 요청 2의 수용 기준 1번 | 서버 구현됨. 화면의 토큰 획득만 남음 |
| task 생성·조회 | 요청 1 | 구현됨 |
| 분석 채택·job | 요청 1 | 구현됨 |
| 미리보기·결정 배치·철회·C 필드 | 요청 2·3 | 구현됨 |

이 문서가 계속 맡는 것은 원자료 catalog·삭제, 초안·검토, 최종 파일·확정·내보내기, 재사용 규칙,
작업 목록·이벤트, 실행 환경 조회다.

## 요청 0 — 세션·CSRF 계약

- 대상: 쓰기 요청의 세션·CSRF·Host/Origin·멱등 키 계약.
- 현재 상태: 병합된 원격 main이 `POST`·`GET /api/v1/session`을 구현했다(`docs/api.md` `:125-129`).
  남은 것은 화면이 세션에서 토큰을 받아 쓰기 경로에 넣는 일이다. 이 문서의 세션 요청은 그 연결과
  쿠키 수명·재시작 폐기 정책이 구현과 맞는지 확인하는 데 쓴다.
- 문서 요구: 시작 토큰은 암호학적 난수로 터미널에만 표시하고 5분·1회 사용, 세션은 8시간 고정,
  쿠키는 `HttpOnly`·`SameSite=Strict`·`Path=/`, 재시작 시 폐기, 로그아웃 경로 제공, 쓰기 요청은
  세션·CSRF·`Idempotency-Key`를 함께 검사, Origin은 실제 Host와 정확 비교, 외부 CORS 금지
  ([실행 경계](features/10-runtime-boundary.md) `:57`, `:59`, `:61`, `:91-93`).
- 이미 있는 부분: 클라이언트가 `X-CSRF-Token`·`Idempotency-Key`를 붙이고
  (`packages/client/src/disclosure-state.ts:325-326`, `:655-656`), 토큰이 없으면 쓰기를 보내지
  않는다(`packages/client/src/disclosure-contract.ts:502-504`). 서버는 병합된 main에서
  `POST`·`GET /api/v1/session`과 세션 쿠키 검사를 제공한다(`docs/api.md` `:125-129`).
- 없는 부분: 화면이 세션을 호출해 토큰을 받는 경로가 없다. `packages/client/src/main.ts:39`는
  토큰 없이 공개 결정 영역을 마운트하므로, 서버가 열려도 운영 화면의 쓰기는 막힌다.
- 수용 기준:
  - 토큰 없는 쓰기는 401/403으로 거부하고, 성공·실패 모두 응답에 토큰이나 세션 비밀을 싣지 않는다.
  - 다른 Host·Origin에서 온 쓰기는 거부하고, 거부 사유를 클라이언트가 표시할 수 있는 코드로 준다.
  - 같은 `Idempotency-Key` 재전송은 첫 응답을 재현하고 부수 효과를 두 번 만들지 않는다(INV-16).
  - 재시작 뒤 기존 세션 쿠키는 무효다.
- UI 접속점: 모든 쓰기 버튼의 사전 차단을 해제하는 지점. 현재 화면은 토큰이 없다는 사유만
  표시한다(`packages/client/src/disclosure-contract.ts:502-504`).

## 요청 1 — 작업 생성과 원자료 등록

- 대상: 화면에서 새 작업을 만들고 원자료를 그 작업의 판본으로 저장하는 HTTP 접점. 이 접점이
  없으면 사용자는 공개 결정 화면에 입력할 task ID를 스스로 만들 수 없다.
- 현재 상태: 병합된 main이 `POST /api/v1/tasks`·`GET /api/v1/tasks/{id}`·`PUT
  /api/v1/tasks/{id}/sources`를 노출해 생성과 원자료 등록은 열렸다(`docs/api.md` `:150-152`).
  이 요청에서 남은 것은 catalog·자료 삭제·자료 한도 정본이다.
- 이미 있는 내부 기능: `TaskStore.create(context, sourceSetHash, skillSetHash)`가 revision 1과
  `needs_analysis` phase, 스냅샷을 함께 만든다(`packages/server/src/task-store.ts:54-65`).
  `AnalysisStore.replaceSources`는 원자료를 전량 검증한 뒤 한 트랜잭션으로 교체한다
  (`packages/server/src/analysis-store.ts:40-71`). `AnalysisStore.sources`로 내부 조회도 된다
  (`:34-39`).
- 없는 부분: `GET /api/v1/catalog`과 `DELETE /api/v1/tasks/{id}/sources/{source_id}`가 없다.
  화면에도 작업 이름·프로젝트·수신자 목록을 고르는 등록 폼이 없고, 목적·수신처는 자유 입력 두
  칸뿐이다(`packages/client/public/index.html:41`, `:46`).
- 문서와 구현의 차이(결정 필요):
  - `TaskContext`는 `purpose`·`recipient`·`goal_variant`·`output_language` 네 필드뿐이라
    `internal_title`·`project_id`·`audience`·`skill_ids`를 받을 자리가 없다
    (`packages/core-interface/src/workflow.ts:11-16`, `task-store.ts:56`).
  - `goal_variant`는 내부에서 3종만 허용해 `ask_for_diagnostics`가 거부된다(`task-store.ts:57`,
    `packages/core/src/index.ts:171`).
  - 자료 개수 한도가 문서는 10개([작업 등록 계획](features/01-task-intake.md) `:69`)인데 코드는
    100개다(`packages/server/src/analysis-validation.ts:15`). 어느 쪽이 정본인지 정해야 한다.
  - `replaceSources`는 전량 교체만 지원하고 `included=false` 제외를 거부한다
    (`analysis-validation.ts:19`). 부분 제외가 필요하면 계약을 넓혀야 한다.
- 수용 기준:
  - 작업 생성은 revision 1과 `needs_analysis`로 시작하고, 공개 결정·allow를 만들지 않는다.
  - 원자료 배치는 전부 성공 또는 전부 실패이며, 실패 시 기존 판본이 남는다(INV-07).
  - 등록한 자료의 `sha256`·바이트를 목록에서 확인할 수 있고, 원문을 화면 응답에 그대로 되돌려
    주지 않는다.
  - catalog는 프로젝트·목적·수신자 목록을 서버가 제공하고, 화면은 그 목록 밖 값을 만들지 않는다.
- UI 접속점: 지금의 목적·수신처 자유 입력과 파일 선택을 등록 폼으로 대체하는 자리. 파일은
  아직 `/api/analysis` 요청 본문으로만 쓰이고 저장되지 않는다(`docs/api.md:96-97`).

## 요청 2 — 초안 작성·검토 job

- 대상: 승인된 사실만으로 초안을 만들고, 작성 중 검토·수정·재검토를 job으로 수행하는 HTTP 접점.
- 이미 있는 내부 기능: 파이프라인이 라이브러리로 완성돼 있다.
  - `composeFactPack`이 allow·미철회·미만료 결정만 골라 `FactPack`을 만든다
    (`packages/core-interface/src/compose.ts:6-52`).
  - `RealCore.write`·`review`·`writeReviewed`가 작성·검토·수정 상한 루프를 수행한다
    (`packages/core/src/index.ts:108-142`). 수정 피드백은 reason code·block id·승인 fact id만
    쓰고 자유 설명을 넣지 않는다(`:134-136`, INV-11).
  - `validateDraft`가 DocAST 구조·참조·필수 fact 누락을 검사한다
    (`packages/core/src/validation.ts:36-77`).
  - 호출 예산(단계 2회, 전체 12회)과 전역 동시성 1이 설정으로 강제된다
    (`packages/core/src/index.ts:35-57`, `packages/app/src/config.ts:29-30`).
- 없는 부분:
  - 앱 조립부가 `TaskStore`나 Engine을 조립하지 않는다. `packages/app/src/main.ts:12`는
    `createApp(store, core, core)`에 문서 저장소만 넣는다.
  - `kind=compose|review` job, `fact_packs`·`reviews`·`findings` 저장, 초안 렌더(파일 생성),
    `PUT artifacts/{id}/edit`, `POST artifacts/{id}/human-review`가 모두 없다. 4개 패키지에서
    artifact·finalize·bundle·render 심볼은 0건이다.
  - phase enum이 `needs_analysis|needs_decisions|ready_to_generate` 3개뿐이라
    `processing|needs_attention|ready_to_finalize|finalized`를 표현할 수 없다
    (`packages/server/src/task-schema.ts:6` ↔ `docs/IA.md:90-96`).
- 수용 기준:
  - writer 입력에 원자료·파일명·내부 설명이 들어가지 않고, 승인팩과 등록 양식만 받는다(INV-04).
  - 검토 결과는 `review.v1` 형태로 저장되고, `needs_changes`면 fixed reason code로만 재작성한다.
  - 같은 revision의 새 job이 시작되면 이전 job은 stale이 되어 늦은 응답이 현재 초안을 덮지
    않는다(INV-07).
  - 사람 검토는 기계적 hard gate를 우회하지 못하고, 검토 대상 해시에 묶인다(INV-08, INV-14).
  - 초안 생성 성공과 편집·검토 재실행이 서로 다른 revision을 만든다.
- UI 접속점: 작업 공간의 초안 영역과 `공유 초안 생성`, 하단 주 동작의 `검토 다시 실행`. 지금은
  두 버튼 모두 코드에서 강제 비활성이고(`packages/client/src/main.ts:35-37`), 화면은
  "연결되지 않았습니다" 문구만 보여 준다(`packages/client/public/index.html:69-70`).

## 요청 3 — 최종 파일·확정·내보내기

- 대상: 후보 파일을 실제 바이트로 만들고, 그 바이트를 확정한 뒤 복사·개별 다운로드·패키지
  다운로드로 같은 바이트를 돌려주는 경로.
- 이미 있는 내부 기능: **없다.** 렌더러·파일 생성·manifest·`artifact_set_hash`·ZIP 생성·
  `EXPORT_INVALIDATED`·클립보드 경로가 코드에 하나도 없다. 재사용 가능한 조각은 revision 검사
  (`packages/server/src/task-store.ts:74-76`), 유효 allow 판정(`:174-178`), 트랜잭션 원시함수
  (`:49-54`) 정도다.
- 없는 부분: `GET /api/v1/artifacts/{id}`, 파일 미리보기, `finalize`, export 파일·archive 라우트,
  그리고 `artifacts`·`artifact_files`·`exports` 테이블. 참고 계약에만 있다
  (`contracts/openapi.json:2209`, `:2436`, `:2493`).
- 수용 기준:
  - 확정 전 검사(현재 revision·artifact_set_hash·결정 유효·보류 없음·검토 hash 결합·필수 검사
    통과·명시적 확인)를 모두 통과해야 하고, 확정 트랜잭션 안에서 다시 확인한다
    ([최종 확인·내보내기 계획](features/05-export.md) `:87-100`, INV-09).
  - 다운로드는 확인한 불변 파일의 동일 바이트를 반환하고, 철회·만료 시 409 `EXPORT_INVALIDATED`로
    거부하며 재생성으로 대체하지 않는다.
  - 패키지는 allowlist 파일만 담고 절대경로·상위경로·역슬래시·중복 이름·심볼릭 링크를 거부하며,
    고정 시각·권한을 쓴다([최종 확인·내보내기 계획](features/05-export.md) `:81`).
  - 확정 후 편집은 새 revision과 재검토를 요구한다.
- UI 접속점: `최종 파일 확인`과 확정 후 복사·다운로드. 지금 `finalize-document`는 비활성이고
  (`packages/client/public/index.html:73-74`, `main.ts:35-37`), 클라이언트에 artifact·export를
  부르는 코드가 0건이다.

## 요청 4 — 재사용 규칙 저장·적용·철회

- 대상: 이번 결정을 같은 조건에 다시 쓰는 규칙으로 저장하고, 목록·적용·새 판본·철회를 제공하는
  경로.
- 현재 상태: 병합된 main도 규칙을 구현하지 않았다. 결정 배치가 `save_reusable_rule`을 422
  `RULE_REUSE_NOT_IMPLEMENTED`로 거부하고(`packages/server/src/workflow-http.ts:196`), 세션
  capability도 `reusable_rules:false`다(`:66`).
- 이미 있는 내부 기능: 규칙 **검증**만 있다. `groundFacts`가 id·version 일치, 판본별 철회·만료,
  scope·representation·selector 일치, goal 바인딩 1개를 검사한다
  (`packages/core-interface/src/grounding.ts:71-80`). `composeFactPack`은 `applied_rule_id`가
  있으면 `fact_summary`·`derived_table`만 허용한다(`compose.ts:24-26`).
- 없는 부분: 규칙 저장 테이블·저장 API·매칭·후보 선정·변환 재계산·목록·새 판본·철회가 모두 없다.
  `Rule` 타입(`workflow.ts:135-138`)은 입력 검증용 스냅샷일 뿐이다. 클라이언트는 결정 배치에
  `save_reusable_rule`을 실어 보내지만(`disclosure-state.ts:1141-1151`), 내부 배치는 허용 필드
  화이트리스트로 그 필드를 거부한다(`packages/server/src/task-store.ts:141`).
- 수용 기준:
  - 규칙 저장은 결정 배치의 일부인지 별도 호출인지 하나로 정하고, 클라이언트가 이미 보내는 필드
    이름과 합의한다.
  - 적용은 조건이 맞는 변환만 새 자료에 다시 계산하고, 과거 문장·새 정확값·새 원문 구간을 자동
    허용하지 않는다(INV-10).
  - `selected_fields`·`exact_value`·원문 구간은 재사용 저장 대상이 아니다.
  - 새 분석 결과를 채택할 때의 자동 적용은 후보 집합과 파생 결정을 같은 트랜잭션에 저장하고,
    입력 revision이 현재와 일치해야 한다. 여러 규칙이 서로 다른 결과를 만들면 더 많이 공개하는
    쪽을 고르지 않고 해당 항목을 결정 필요로 돌린다([재사용 규칙 계획](features/06-decision-reuse.md)
    `:67`, `:69`).
  - 최신 판본을 쓸 수 없다고 과거 판본으로 자동 fallback하지 않는다.
  - 철회·만료는 전 판본에 적용되고, 확정·다운로드 시점에 다시 검사한다.
- UI 접속점: 공개 결정의 `재사용 기준으로 저장` 체크박스(`disclosure-view.ts:1106-1136`)와
  `스킬로 등록` 버튼(비활성, `index.html:94-95`).

## 요청 5 — 작업 목록·이력·취소·삭제

- 대상: 최근 수정순 작업 목록, 이벤트 이력, 실행 취소, 작업 삭제.
- 현재 상태: task 삭제·job 취소·job 조회는 병합된 main에 있다(`docs/api.md` `:155`, `:163`).
  작업 목록·이벤트·삭제 확인 문자열은 아직 없다.
- 이미 있는 내부 기능: `TaskStore.delete(id, revision)`이 revision을 본 뒤 행을 지운다
  (`packages/server/src/task-store.ts:187-189`). `AnalysisStore.cancel`은 `running`일 때만
  `cancelled`로 바꾼다(`packages/server/src/analysis-store.ts:91-93`). 늦은 worker 응답 거부는
  `AnalysisStore.complete`에 있다(`:135-158`).
- 없는 부분: 목록·cursor, 이벤트 테이블·SSE(`seq`, `Last-Event-ID`), `cancel_requested`·
  `current_job_id` 비교, 삭제 확인 문자열(`DELETE`)·멱등 응답, 규칙 참조 해제가 없다. 화면에는
  목록·이력·삭제 UI가 없다.
- 문서와 구현의 차이(결정 필요): 삭제 계약이 요구하는 `confirmation="DELETE"`와
  `acknowledge_saved_rules_retained` 검증이 내부에 없고, `TaskStore.delete`는 revision만 본다.
  실행 중 job이 있으면 취소 후 삭제인데 현재는 CASCADE로 행만 사라진다.
- 수용 기준:
  - 목록은 최근 수정순·cursor 페이지이고, 내부 원문이나 모델 응답을 자동 노출하지 않는다.
  - 이벤트 이력은 시간순이며 측정하지 않은 값은 `미측정`으로 표시한다(`docs/IA.md:166`).
  - 취소는 서버 상태를 먼저 바꾸고, 물리 종료 전에 완료로 표시하지 않는다.
  - 삭제는 진행 job을 취소하고, 남는 재사용 규칙을 고지하며, 같은 요청 재전송에 같은 결과를 준다.
- UI 접속점: 화면에 영역 자체가 없어 새로 만들어야 한다. 현재의 `저장된 내부 문서` 목록은
  `/api/documents`이고 작업 목록이 아니다(`packages/client/src/main.ts:114-145`).

## 요청 6 — 실행 환경 조회

- 대상: 실행 모드·모델 식별자·앱 버전·등록 확장·검사기·재현 환경 상태·디버그 기록 정책을
  화면에 보여 주는 응답.
- 현재 상태: 세션 응답이 `analysis_environment`(provider_origin·approval_status·verified_at)와
  `capabilities`를 함께 준다(`packages/server/src/workflow-http.ts:63-66`). 별도
  `/api/v1/runtime`은 없고 앱 버전·디버그 기록 정책도 응답에 없다.
- 문서 요구: `GET /api/v1/runtime`과 `catalog`([화면 구조](IA.md) `:179`,
  [실행 경계](features/10-runtime-boundary.md) `:93`). fixture 고정 라벨과 live→fixture 자동 전환
  금지도 함께 요구된다(`docs/IA.md:181`, INV-15).
- 이미 있는 부분: `GET /api/core`가 `implementation`·`connection`·`ready` 세 값만 준다
  (`packages/server/src/app.ts:39-40`, `packages/core-interface/src/model.ts:14-18`). 화면은 이
  값으로 `실제 모델`/`개발용 예시 응답` 라벨을 만든다(`packages/client/src/main.ts:225-237`).
- 없는 부분: 모델 식별자(`ModelClientInfo.model`은 있으나 응답에 없음), 앱 버전, 확장·검사기·
  재현 상태, 디버그 본문 기록 여부·보존 정책이 응답에 없다. `/api/v1/runtime`은 404다.
- 결정 필요: `/api/core`를 확장할지 `/api/v1/runtime`을 새로 만들지, 그리고 확장 시 응답 필드가
  참고 계약과 다른 새 필드가 되는 점을 어떻게 다룰지.
- 수용 기준:
  - 응답에 endpoint URL·자격 증명·토큰이 들어가지 않는다([실행 경계](features/10-runtime-boundary.md) `:65`).
  - fixture와 live가 화면에서 구분되고, 자동 전환은 일어나지 않는다.
- UI 접속점: `실행 정보` 접이식 영역(`index.html:150-198`).

## 구현된 미리보기 엔진(preview·interpret)

[1편](ui-api-requests.md) 요청 2가 요구한 미리보기와 D 조건 해석은 병합된 main에서 엔진까지
연결됐다. `RealCore.preview`가 `calculatePreview`로 위임하고(`packages/core/src/index.ts:213-215`),
`proposeDisclosure`는 모델 응답을 검증해 제안을 만든다(`:195-211`). 표현 검증은
`validateRepresentation`, 계산은 `calculatePreview`다(`packages/core/src/disclosure.ts:8`, `:26`).

- 남은 확인: 실제 모델 입력으로 A~D 결과가 문서의 표현 정의와 일치하는지, 계산할 수 없는 표현이
  거부되는지는 이 문서를 쓰면서 실행으로 확인하지 않았다.
- UI 접속점: 공개 결정 영역의 미리보기 표. 화면은 서버 응답만 그린다
  (`packages/client/src/disclosure-state.ts:320`).

## 관련 요청 — 문서·계약 정리

서버 담당자가 구현 전에 정해야 할 충돌을 먼저 적는다. 구현 후에 정하면 클라이언트를 다시 고쳐야 한다.

| 항목 | 충돌 내용 | 근거 |
| --- | --- | --- |
| 확정 요청 필드 | `confirm=true`와 `confirmed`가 문서마다 다름 | `docs/API와역할계약.md:45` ↔ `contracts/openapi.json:2303` |
| 세션 경로·메서드 | `POST /api/v1/auth/session` ↔ `GET /api/v1/session` | `features/10-runtime-boundary.md:57` ↔ `contracts/openapi.json:2936` |
| 자료 개수 한도 | 10개 ↔ 100개 | `features/01-task-intake.md:69` ↔ `packages/server/src/analysis-validation.ts:15` |
| phase enum | 7단계 요구 ↔ 내부 3단계 | `docs/IA.md:90-96` ↔ `packages/server/src/task-schema.ts:6` |
| 실행 환경 라우트 | `/api/v1/runtime` ↔ `/api/core` | `docs/IA.md:179` ↔ `packages/server/src/app.ts:39` |
| 기본 바인딩 | `127.0.0.1` ↔ `0.0.0.0` | `features/10-runtime-boundary.md:57` ↔ `packages/app/src/main.ts:13` |
| 참고 계약 표기 | `openapi.json`의 `(구현된 API)` 표기 | `contracts/openapi.json` ↔ `contracts/README.md:3` |

## 확인 경계

- 이 문서의 사실 확인은 정적 읽기다. 실행·빌드·데모를 새로 돌리지 않았고, 서버를 띄워 라우트를
  호출한 결과도 아니다.
- 화면 실행 관찰은 [UI 구현 기준의 분석 연결 실행 확인](UI-구현기준.md#분석-연결-실행-확인)과
  [1편의 확인 경계](ui-api-requests.md)에 기록된 범위까지만 유효하다. 병합된 서버의 `/api/v1/*`가
  실제로 응답하는지는 이 문서에서 실행으로 확인하지 않았다.
- `contracts/` 경로가 문서에 있다는 이유로 현재 서버에 존재한다고 쓰지 않는다. 병합 뒤 라우트
  정본은 `docs/api.md` `:112-163`이다.
- 이 문서는 F04~F06, UI-02·UI-07·UI-09의 요구를 새로 만들지 않는다. 요구는 기준 문서에 있고,
  여기서는 서버가 제공해야 할 접점과 수용 기준만 옮겨 적었다.
