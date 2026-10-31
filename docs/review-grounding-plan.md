# 재사용 결정 근거(grounding)와 기본 거부 리뷰 워크플로우 계획

## 문제

지금 `composeFactPack`/`Engine.review()`는 `decisions: Decision[]`를 받지만, 각 fact가 "이번 작업에서
새로 승인한 결정"인지 "사용자가 과거에 재사용하기로 저장한 기준(F06 rule)을 지금 다시 적용한 결정"인지
구분해 리뷰어에게 넘기지 않는다. `contracts/decision.v1.schema.json`을 다시 보면 이 구분은 실제
wire 계약에 이미 있다 — `applied_rule_id`/`applied_rule_version`이 **필수 필드**다(빈 문자열=재사용 아님).
1라운드에서 core-interface의 `Decision`을 줄일 때 이 서버 감사 필드를 의도적으로 뺐는데, 지금 요청은
정확히 그 필드가 다시 필요한 경우다.

요청한 동작: 작성 결과가 그대로 사용자에게 가지 않고 반드시 리뷰를 거쳐야 하며, 리뷰어는 "재사용
결정으로 공개된 것처럼 보이는 내용"에 대해 그 근거(어느 rule, 몇 번 판본)가 실제로 주어졌는지 확인하고,
근거가 없으면 **기본적으로 거부**한다.

## 설계

### 1. 타입 복원·추가 (`packages/core-interface/src/workflow.ts`)

- `Decision`에 `decision.v1` 그대로 `applied_rule_id: string`(빈 문자열=재사용 아님), `applied_rule_version: number`를 복원한다. 이번엔 서버 감사용이 아니라 Engine이 직접 써야 하는 필드라 뺄 이유가 없어졌다.
- `rule.v1`을 그대로 반영한 `Rule` 타입 신설: `{ id, version, scope: Scope, selector: string, representation: Representation, expires_at: string|null, revoked: boolean }`. `Scope`는 `decision.v1`/`rule.v1`에 똑같이 나오는 `{ project_id, purpose_id, recipient_id, audience, skill_set_hash }`를 공유 타입으로 뽑는다.
- `ComposeFactPackInput`에 `rules: Rule[]`(이번 작업에 적용 가능하다고 서버가 넘긴 활성 rule 목록)을 추가한다.
- `FactPack` 자체(`fact_pack.v1`)는 고정 wire 계약이라 필드를 늘리지 않는다. 대신 `composeFactPack`의 반환형을 `{ pack: FactPack; grounding: FactGrounding[] }`로 바꾸거나(계약 변경 필요) 별도 함수 `groundFacts(decisions, rules): FactGrounding[]`를 나란히 둔다 — 아래 `FactGrounding`:
  ```ts
  export interface FactGrounding {
    fact_id: string;
    source: 'fresh_decision' | 'reused_rule';
    rule_id?: string;
    rule_version?: number;
  }
  ```
- `Engine.review(draft, factPack, grounding?: FactGrounding[])` — `review()`는 core-interface 내부 계약(wire schema 아님)이라 자유롭게 매개변수를 추가할 수 있다.

### 2. 결정적 1차 검증 — "기본 거부"의 핵심은 프롬프트가 아니라 코드

F06 hard rule(D10): `exact_value`/`approved_excerpt`는 절대 재사용 불가. 이건 LLM 판단에 맡기지 않고
`composeFactPack` 단계에서 바로 거부한다:

```
decision.representation.kind in {exact_value, approved_excerpt} AND decision.applied_rule_id !== ''
  → 즉시 실패 (서버의 F06 매칭이 이미 막아야 하는 상황이지만, Engine도 독립적으로 재검사)
```

재사용 가능한 종류(`fact_summary`/`derived_table`/`selected_fields`)라도, `applied_rule_id !== ''`인데
그 id/version과 일치하는 `Rule`이 `rules` 입력 목록에 없거나, 그 rule이 `revoked`/만료/scope 불일치면
**모델을 호출하기 전에** 코드가 바로 `Review`를 `{ result: 'needs_decision', issues: [{ reason_code:
'NEEDS_DISCLOSURE_DECISION', ... }] }`로 강제한다 — `validateDraft`가 지금 구조 오류를 코드로 잡는 것과
같은 자리에 둔다(`packages/core/src/validation.ts`). `NEEDS_DISCLOSURE_DECISION`은 이미 `review.v1`의
확정된 enum 값이라 새 reason_code를 계약에 추가할 필요가 없다.

### 3. 프롬프트 레이어 — 보조 수단

코드 검증은 "근거로 주어진 rule_id가 실제로 유효한가"만 기계적으로 확인한다. "문장이 과거 자료를 은근히
베낀 것처럼 보이는가" 같은 애매한 경우는 여전히 LLM 판단이 필요하므로, 리뷰 프롬프트에 다음을 명시한다:

> 각 fact에는 grounding이 함께 주어진다(fresh_decision 또는 reused_rule+rule_id+rule_version). 초안이
> grounding에 없는 과거 승인이나 "이전과 동일" 같은 표현에 의존하는 것처럼 보이면
> `NEEDS_DISCLOSURE_DECISION`으로 반려한다. grounding이 비어 있거나 이 fact를 설명하지 못하면 통과시키지
> 않는다.

이 프롬프트는 2번(코드)이 이미 막은 경우를 다시 확인하는 defense-in-depth이며, 2번을 대체하지 않는다.

### 4. Rule 매칭 자체는 범위 밖

F06 §2: "서버만 현재 입력과 기준을 매칭한다." scope 비교·활성/미만료/미철회 판정·"applied_rule_id 채우기"는
서버 책임이며 이번 계획에 넣지 않는다. Engine/writer는 `rules`/`applied_rule_id`가 이미 올바르게
채워져 들어온다고 가정하고, **그 근거가 끝까지 리뷰어까지 전달·검증되는 것**만 책임진다. 실제 rules
테이블·매칭 엔진·UI-04/08은 F06 §10의 구현 순서(scope 비교 → rule 판본 저장 → 분석 결과 원자적 적용 →
UI → 철회/만료 전파)를 따르는 별도의 큰 작업이다.

## 범위에서 빼는 것

- F06 본체(서버의 `rules` 테이블, scope 매칭 엔진, 철회/만료 전파) — 별도 작업.
- UI(F06 §3의 UI-04/08).
- `composeFactPack` 반환형 변경은 계약(함수 시그니처) 변경이라, 실제 구현 시작 전에 "별도 함수로 둘지,
  반환형을 바꿀지" 한 번 더 확인이 필요하다(아래 OSS 재현 계획엔 영향 없음).

## 지난 OSS 재현 계획과의 관계

OSS 재현 스모크 테스트(아래)는 facts를 그 자리에서 손으로 구성해 바로 승인하는 것이라 `applied_rule_id`가
항상 빈 문자열(= 신선한 결정)이다. 즉 이 grounding 로직과 충돌하지 않고, grounding 쪽 구현이 없어도
OSS 재현 계획은 독립적으로 진행할 수 있다.
