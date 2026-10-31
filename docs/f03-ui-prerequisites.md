# F03 착수 전 — UI가 미리 맞춰둬야 할 계약 체크리스트

`packages/client`의 현재 화면(공개 방식 A~D, "자료 분석 시작" 등)은 전부 `disabled`이고 주석에도
"A~D, 미리보기, 결정 저장, 분석, 확정, 스킬 등록은 서버 API가 없으므로 화면에서 성공을 만들지
않는다"고 명시돼 있다 — 가짜 성공을 만들지 않은 정직한 상태다. 하지만 지금 DOM 구조와
`docs/features/03-disclosure-decisions.md`(F03 §3·§6)의 실제 계약을 대조하면, 백엔드를 연결하는
시점에 DOM을 다시 짜야 할 구조적 차이가 몇 개 있다. 구현은 하지 않고 계약만 정리한다.

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

지금 "조건 확인" 버튼은 있지만 아무 상태 분기가 없다. 실제로는 `interpret_condition` job이
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

## 이번에 하지 않은 것

위 10개는 전부 "연결 시점에 뭘 결정해야 하는지"의 목록이며, 지금 DOM/CSS를 고치지 않았다.
1번(candidate별 목록 구조)이 나머지 대부분(3·4·6·10번)의 전제조건이라 실제 작업 순서를 정할 때
먼저 보는 게 맞다. F02(`analyze()`)가 끝나야 실제 candidate가 생기므로, 이 체크리스트의 적용은
[F02 계획](f02-analyze-plan.md) 이후다.
