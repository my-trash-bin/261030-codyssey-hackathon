# F03 착수 전 — UI가 미리 맞춰둬야 할 계약 체크리스트

현재 서버 세션·task/job·미리보기·결정·철회·C 변환은 구현했다. 아래 체크리스트는 선행 UI 설계
기록이며 서버 부재를 적은 항목은 [실제 API](api.md)로 대체한다. 화면의 남은 연결은
[UI 요청 현황](ui-api-requests.md)의 TODO를 따른다.

아래 1~10은 UI 선행 작업을 시작하기 전의 점검 기록이다. 당시 `packages/client`에는 전역 A~D
설명과 비활성 적용 버튼만 있었으며 후보별 결정을 표현할 수 없었다. 자료 분석·공개 승인·초안
작성의 실제 연결과 UI 구조 준비는 별개로 다룬다.

이 선행 UI의 요청·응답 형태는 `contracts/openapi.json`과 `task.v1`·`disclosure_preview.v1`·
`decision.v1`·`job.v1` 스키마를 참고해 준비한다. 다만 [참고 계약의 경계](../contracts/README.md)처럼
이 자료들은 현재 서버의 동작 API가 아니다. 아래에서 UI 준비와 실제 연결 여부를 구분한다.

## 1. 구조 전환: 전역 선택 → candidate별 목록 (가장 큰 차이)

지금 `index.html`은 `name="disclosure"` 라디오 4개(A~D) **하나**와 "이 방식으로 적용" 버튼
**하나**로 작업 전체를 다룬다. 하지만 F03은 본질적으로 **candidate 하나당 하나의 결정**이다
(`GET /api/v1/tasks/{id}/candidates`가 목록을 반환하고, 각 항목이 독립적으로
allow/exclude/defer + representation을 가진다). 지금 구조로는 candidate가 2개만 되어도 표현할
방법이 없다. 백엔드 연결 전에 "candidate 목록 반복 렌더링" 구조로 먼저 바꿔야 한다 — 지금
고치지 않으면 연결 시점에 마크업을 통째로 다시 짜야 한다.

## 2. 두 단계가 분리돼야 한다: 미리보기와 결정 저장은 다른 동작

F03 §3: "선택지 클릭은 미리보기 요청이다. `이 방식으로 적용`에서만 결정이 저장된다." 지금
`main.ts`의 라디오 클릭 핸들러는 고정 설명 문자열(`disclosureDescriptions`)만 보여준다 — 실제
데이터로 계산한 projection이 아니다. 연결 시점에는:
- A/B/C/D 선택 → `POST /tasks/{id}/disclosure-previews`(candidate_id, representation) 호출 →
  실제 `projection`/`projection_sha256` 렌더.
- "적용" 클릭 → 그 `preview_id`+`hash`를 참조해서만 결정 배치에 포함.
- revision이 바뀌면 기존 preview는 무효 — "적용" 전에 재확인 없이 그냥 눌리면 안 된다.

## 3. disposition은 세 가지, "선택함/안 함" 둘이 아니다

allow(미리보기 승인) / exclude(이번 결과에서 제외) / defer(나중에 결정) — 지금 UI는 라디오를
안 누르면 "아직 선택 안 함"만 표현한다. candidate별로 exclude·defer를 **명시적으로 고르는
행동**이 따로 있어야 한다(F03 §3 "기본 상태는 허용 미선택이다. `나중에 결정`은 defer, `이번
결과에서 제외`는 exclude다").

## 4. 저장은 배치 단위, candidate별 개별 저장이 아니다

`POST /tasks/{id}/decision-batches`는 **그 시점의 모든 candidate 결정을 한 번에** 받고, 하나라도
미리보기/근거/범위가 틀리면 **배치 전체**가 거부된다(F03 §5·AC-F03-07/08). UI는 candidate별로
즉시 저장 호출을 날리면 안 되고, 클라이언트 상태에 모아뒀다가 "전체 적용" 같은 단일 배치 호출로
보내야 한다. 지금의 "이 방식으로 적용" 버튼 하나는 이 배치 제출 자리가 될 수 있지만, 지금은
candidate가 하나뿐인 것처럼 짜여 있어 그대로 못 쓴다(1번과 같은 문제).

## 5. revision/동시성 상태가 클라이언트에 전혀 없다

지금 `main.ts`는 `/api/documents`, `/api/core`만 부르고 `revision`/`expected_revision`/
`Idempotency-Key` 개념이 아예 없다. F03의 모든 쓰기 API가 `expected_revision`을 요구하고
불일치면 배치 전체 거부다(AC-F03-07). 연결 전에 "현재 task의 revision을 어디서 들고 있다가
모든 요청에 실어 보낼지"를 결정해야 한다 — 매 요청 직전에 다시 조회할지, 상태에 캐시해두고
409류 응답에서만 재조회할지는 열린 결정이다.

## 6. required 표시와 "빈 문서 금지"가 시각적으로 없다

candidate에는 `required`(boolean)가 있고(F03 §5), required를 제외하면 목적 달성이 왜
부족해지는지 설명해야 하며, 공개 정보가 전혀 없는 빈 문서를 성공으로 만들면 안 된다
(AC-F03-12). 지금 화면엔 candidate 목록 자체가 없으니 이 표시도 없다 — 1번 구조 전환과 같은
작업으로 같이 간다.

## 7. D(직접 입력)는 "조건 확인" 결과에 따라 분기해야 한다

착수 전에는 "조건 확인" 버튼만 있고 상태 분기가 없었다. 현행 계약의 `interpret_disclosure` job이
`supported`/`ambiguous`/`unsupported`를 반환하고, **supported일 때만** 그다음 미리보기 단계로
넘어간다(F03 §5 "직접 입력"). ambiguous/unsupported는 적용 버튼을 계속 막아야 한다
(AC-F03-05).

## 8. 표현 내용은 고정 설명문이 아니라 실제 계산값이어야 한다

지금 `disclosureDescriptions`/`disclosureCautions`는 A~D마다 고정된 설명 문자열이다. 실제로는
B의 projection이 "첫 번째/기준, 두 번째/증가, 세 번째/증가"처럼 **그 자료의 실제 계산 결과**이고
C는 **사용자가 고른 실제 필드·값**을 보여줘야 한다(F03 §3 표). 고정 문구 컴포넌트가 아니라
표/값을 렌더링할 수 있는 컴포넌트가 필요하다 — 지금 것은 그대로 못 쓴다.

## 9. 재사용(F06) 토글은 표현 종류에 따라 UI에서부터 막아야 한다

exact_value·approved_excerpt·실제값 selected_fields는 `reusable=false`가 강제다(F03 §9,
decisions.md). 나중에 "재사용 기준으로 저장" 토글을 추가할 때, 서버 검증에만 맡기지 말고 해당
representation을 고른 candidate에서는 그 토글 자체를 처음부터 숨기거나 비활성화해야 한다.

## 10. 철회(revoke)·충돌(conflict) 화면이 아직 없다

`POST /tasks/{id}/decisions/{decision_id}/revoke`에 대응하는 UI 동작이 전혀 없고, F02의
`conflicts[]`(서로 다른 근거가 충돌)를 보여주는 자리도 없다(F03 §3 "자료가 충돌함"). 둘 다
candidate 목록 구조(1번)가 생긴 뒤에 그 위에 얹는 게 자연스럽다.

## 적용 순서와 연결 경계

1번 후보별 목록 구조를 먼저 적용하고 그 위에 결정·미리보기·일괄 적용 상태를 둔다. 실제 후보의
생성과 분석은 [F02 계획](f02-analyze-plan.md)의 범위이며 UI가 가짜 후보를 대신 만들지 않는다.

이 체크리스트는 기존 UI를 연결 가능한 구조로 준비하는 요구다. 별도 작업 계약 파일이나 새 API를
먼저 만들 필요는 없다. 후보 표시에는 이미 구체화된 작업 전체 응답 `task.v1`을 사용한다.
원문의 후보 전용 GET과 경로는 다르지만 후보별 독립 렌더링을 위한 데이터는 이 응답에 포함된다.

다음은 UI 구조 준비와 구분해야 하는 실제 연결 조건이다.

- F02 분석 응답의 서버 candidate_set 채택은 `TaskStore.analysis`·`runTaskAnalysis` 내부 경로로 구현됐고, task·preview·decision·job HTTP 라우트의 실제 제공과 화면 연결이 남았다. `POST /api/analysis`는 작업 화면의 파일 입력과 연결되어 근거·후보 제안을 내부 검토용으로 표시하지만, 응답의 임시 evidence·후보 참조를 task·candidate로 저장하거나 조회·결정 경로로 넘기지는 않는다. task HTTP 조회는 여전히 미연결이다.
- C의 정의·구현 정리. 보존된 `contracts/core/shared.schema.json`에는 이미 `select_fields.v1`의
  `parameters.fields: string[]`가 있다. 반면 UI 준비 기준으로 삼은 HTTP 스키마에는 `fields`와
  `select_fields.v1`이 없다. 이는 참고 자료 간 불일치이지 실제 서버가 해당 필드를 거부한 관측이 아니다.
  C를 동작시키려면 기존 정의를 맞추고 선택 가능한 필드 목록의 공급 방식과 서버 변환을 구현해야 한다.
  새 계약 파일이나 새 API를 먼저 만들 문제는 아니다. UI가 원자료에서 공개 표를 대신 계산하지 않는다.
- 세션 응답의 CSRF 토큰 필드·획득 방식. `/api/v1/session`의 성공 응답 `data`는 아직 구체화되지 않았다.
- 후보 전용 조회와 일괄 적용·철회 응답의 구체적인 DTO. 적용·철회 뒤에는 성공 응답을 추정하지 않고 작업 전체를 재조회한다.

임의 필드·인증 응답·성공 결과를 만들지 않는다. UI 동작 확인과 실제 서버 승인·저장은 별도로 보고한다. 분석 결과 채택의 HTTP 노출·결정 HTTP·C 필드의 남은 요청은 [분석 UI 이후 서버 요청](ui-api-requests.md)에 대상·기존 기능·빠진 접점·수용 기준으로 나눠 적었다.

## UI 선행 작업 반영

| 항목 | UI 반영 | 실제 연결 경계 |
| --- | --- | --- |
| 1. 후보별 목록 | 작업 전체 응답을 받아 후보별 독립 결정·표현을 렌더링 | F02 결과의 내부 채택은 구현됨. task HTTP 조회와 화면 연결은 미연결 |
| 2. 미리보기·저장 분리 | 요청 가능한 상태에서 A·B 선택 시 미리보기만 요청하고, 서버 projection·해시를 표시해 allow에만 참조를 결합 | C의 필드 선택·미리보기는 미완료. 토큰 없는 운영 화면은 전송하지 않으며 결정 저장은 전체 적용에서만 수행 |
| 3. 결정 3종 | 미선택·allow·exclude·defer를 구분 | 미선택을 자동 허용하거나 defer로 바꾸지 않음 |
| 4. 일괄 적용 | 선택한 결정만 단일 배치로 제출, 미선택은 제외 | optional 전원 선택과 임의 충돌 해소 규칙을 강요하지 않음 |
| 5. 판본·동시성 | 현재 revision 캐시, expected_revision·Idempotency-Key, 409 재조회, 오래된 응답 폐기 | 내부 TaskStore의 원자적 저장·멱등 검사는 구현됨. UI와의 HTTP 통합은 미연결 |
| 6. 필수성·빈 결과 | 현재 목적·제외되는 실제 정보·제외 취소·범위 축소 동의 대상 목록을 표시, 빈 결과 조건 미충족 안내 | 부분 결정 저장과 최종 확정을 구분. 필수 선정의 구체적 사유는 응답에 없으며 초안 생성 자체는 미연결 |
| 7. 직접 입력 | supported·ambiguous·unsupported 분기, 입력 유지, 진행 중 해석 단건 조회 | interpret_disclosure의 실제 실행은 미연결 |
| 8. 실제 출력 | 서버가 반환한 문장·표·원문 인용·해시를 렌더링 | B는 series_direction_only.v1. C의 실제 필드 선택·값 확인 흐름은 참고 정의 불일치와 필드 목록·서버 변환 미구현으로 미완료 |
| 9. 재사용 제한 | exact_value·approved_excerpt·selected_fields는 재사용 선택 불가 | F06 재사용 규칙 저장·적용의 실제 연결은 별도 |
| 10. 철회·충돌 | 저장 결정·철회 버튼, 충돌 양쪽 문장·근거 구간·원문 발췌 표시 | 양쪽 중 하나를 자동 선택하거나 철회된 과거 허용으로 복귀하지 않음 |

코드는 `packages/client/src/disclosure-state.ts`와 `disclosure-view.ts`로 나누고 `main.ts`에서
연결한다. 프록시는 고정 서버로만 요청을 보내며 Idempotency-Key·CSRF·세션 쿠키 헤더를 보존한다.
새 브라우저 모듈만 정적 제공 허용 목록에 추가하고 테스트 파일은 제공하지 않는다.

운영 화면은 인증 토큰을 임의로 얻지 않는다. 명시적으로 전달된 토큰이 없으면 미리보기·해석·
적용·철회를 전송 전에 차단한다. 실제 task 조회의 404도 작업 부재로 단정하지 않고 API 제공
여부와 ID를 확인하도록 안내한다.

### 확인 근거와 미확인 범위

- `mise exec -- pnpm --filter @safehandoff/client typecheck` 통과.
- 앞선 구현에서 `mise exec -- node --test packages/client/src/disclosure-state.test.ts` 31개와 기존 client 검사 2개가 통과했다. 이번 안내·취소 보완에서는 같은 검사를 반복하지 않고 타입 검사와 아래 실제 브라우저 경로를 확인했다.
- mise의 Node 24.21.0으로 저장소 밖에 클라이언트를 빌드하고, 빌드 모듈 제공·테스트 모듈 404·작업 조회 프록시를 실행 확인.
- 실제 브라우저에서 운영 화면의 task 404·쓰기 차단을 확인. 별도 임시 응답기로 후보별 결정, B의 표·해시, D 분기와 입력 보존, 정확값 재사용 차단, 일괄 적용, 빈 해시 제외·보류 결정 재조회, 철회, 409 뒤 미리보기 무효화를 확인.
- 실제 화면과 가상 후보 화면 모두 320px에서 문서 가로 넘침 없음. 조건 입력 초점 유지와 다음 버튼으로 키보드 이동 확인.
- 임시 응답기는 운영 코드에 포함하지 않는다. 위 확인은 실제 F02 분석·인증·모델 호출·서버 승인 저장·전체 F03 수용 기준의 종단간 통과를 뜻하지 않는다.

### 필수 후보 제외 보완 확인

- 변경 전 가상 작업을 실제 클라이언트로 열어 일반 경고만 보이는 상태를 확인한 뒤 수정했다.
- 오픈소스 버그 제보·B2B 기술지원 문의·외부 운영 자문의 세 목적에서 현재 목적명과 제외되는 실제 후보 문장을 확인했다. 필수 선정 사유나 목적별 필요 정보를 임의로 생성하지 않는다.
- 필수 후보 2개 제외 시 동의 대상 2개, 하나의 제외 취소 후 1개로 갱신됨을 확인했다. 제외 취소는 미선택으로 돌아가며 허용으로 바뀌지 않는다. 키보드 Enter로 취소한 뒤 같은 후보의 제외 라디오로 초점이 복원됐다.
- 필수 제외는 동의 전 전체 적용 비활성·동의 후 활성이다. 선택 후보만 제외할 때는 필수 경고나 범위 축소 동의를 요구하지 않았다.
- 가상 작업의 미저장 상태에서 빈 공유 문서를 완료로 보지 않는 안내를 확인했다. 선택·취소·동의 동작은 쓰기 요청을 만들지 않았고, 응답기 기록은 작업 GET뿐이었다. 이번 확인에서 전체 적용을 실제 저장하지는 않았다.
- 320px에서 문서 폭 320px, 제외 라디오와 동의 체크박스의 설명 연결, HTML 모양의 후보 문장을 텍스트로 표시하는 것을 확인했다. 새 확인 탭의 브라우저 오류 기록은 0개였다.
- axe-core 4.13.0은 위반 0개·미확인 1개를 집계했다. 도구가 미확인 세부 항목을 반환하지 않아 전체 접근성 통과로 판단하지 않으며, 화면 읽기 도구 실사용도 확인하지 않았다.
- 이번 보완은 6번 UI 동작과 잘못된 계약 설명을 바로잡은 것이다. 2·8번의 C 필드 선택·실제 미리보기와 서버 연결은 여전히 미완료다.

### 최신 main 병합 후 확인

- `origin/main`의 `ad07b07`을 작업 브랜치에 병합했다. `DisclosurePreview.raw_grants` 추가는 UI가 소비하는 기존 필드를 바꾸지 않았고 task·decision HTTP 라우트는 여전히 제공되지 않는다.
- 병합 커밋의 저장소 밖 임시 사본에서 `mise exec -- pnpm typecheck`로 전체 패키지 빌드·타입 검사를 통과했다. 다음 영향 범위 검사 63개가 통과했고 실패·건너뜀은 0개였다.

```bash
mise exec -- node --conditions=development --test packages/client/src/*.test.ts packages/core/src/analyze.test.ts packages/core/src/evidence-parser.test.ts packages/server/src/*.test.ts packages/app/src/app.test.ts packages/app/src/config.test.ts packages/core-interface/src/workflow.test.ts
```

- 같은 사본의 실제 앱·클라이언트를 실행해 브라우저의 내부 메모 저장 201·목록 갱신 200, task 조회 404 안내·쓰기 차단, 320px 문서 폭 320px·자바스크립트 오류 0개를 확인했다. 새 분석 API에 `{}`를 보내 400 `INVALID_CORE_INPUT`도 확인했으며 외부 모델은 호출하지 않았다.
- 이는 전체 테스트 묶음이나 실제 모델을 통한 분석·공개 결정의 종단간 확인이 아니다. 실행용 임시 사본·DB·서버·브라우저 탭은 정리했다.
