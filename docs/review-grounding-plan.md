# 재사용 결정 근거(grounding)와 기본 거부 리뷰 워크플로우 계획

## 문제

계획 작성 당시 `composeFactPack`은 `decisions: Decision[]`를 받고 `Engine.review()`는 draft/factPack만 받아, 각 fact가 "이번 작업에서
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
- `FactPack` 자체(`fact_pack.v1`)와 composeFactPack 반환형은 유지한다. 별도 `groundFacts(context, pack, now): FactGrounding[]`를 추가한다. context는 서버가 검증해 전달한 현재 결정·미리보기·scope·source 집합·Rule과 goal 바인딩이며, 다음 요약을 직접 받아 권한으로 신뢰하지 않는다.
  ```ts
  export interface FactGrounding {
    fact_id: string;
    decision_id: string;
    source: 'fresh_decision' | 'reused_rule';
    rule_id?: string;
    rule_version?: number;
  }
  ```
- `Engine.review(draft, factPack, context?: ReviewGroundingContext)`로 검증할 스냅샷을 전달한다. 세 번째 인수가 없는 기존 호출은 타입상 가능하지만 결과는 기본 needs_decision이며, 메타데이터 누락을 새 승인으로 추정하지 않는다.

### 2. 결정적 1차 검증 — "기본 거부"의 핵심은 프롬프트가 아니라 코드

F06 hard rule(D10): `exact_value`/`approved_excerpt`는 절대 재사용 불가. 이건 LLM 판단에 맡기지 않고
`composeFactPack` 단계에서 바로 거부한다:

```
decision.representation.kind in {exact_value, approved_excerpt} AND decision.applied_rule_id !== ''
  → 즉시 실패 (서버의 F06 매칭이 이미 막아야 하는 상황이지만, Engine도 독립적으로 재검사)
```

재사용 후보인 `fact_summary`/`derived_table`도 등록 변환이어야 한다. 실제값을 유지하는 `selected_fields`는 F03의 reusable=false 규칙에 따라 이번 구현에서 재사용을 거부한다. `applied_rule_id !== ''`인데
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
서버 책임이며 이번 계획에 넣지 않는다. Engine은 서버가 전달한 effective snapshot의 바인딩을 독립적으로 재검사한다. 이 입력만으로 서버의 실제 원자료 selector 매칭·변환 재계산을 대신하지는 않는다. **근거가 끝까지 리뷰어까지 전달·검증되는 것**을 책임진다. 실제 rules
테이블·매칭 엔진·UI-04/08은 F06 §10의 구현 순서(scope 비교 → rule 판본 저장 → 분석 결과 원자적 적용 →
UI → 철회/만료 전파)를 따르는 별도의 큰 작업이다.

## 범위에서 빼는 것

- F06 본체(서버의 `rules` 테이블, scope 매칭 엔진, 철회/만료 전파) — 별도 작업.
- UI(F06 §3의 UI-04/08).
- `composeFactPack`의 반환형과 fact_pack.v1 wire 변경은 제외한다. 별도 groundFacts 함수를 선택해 기존 반환형을 유지한다.

## 지난 OSS 재현 계획과의 관계

OSS 재현 스모크는 fixture에서 직접 구성한 새 승인만 사용하므로 applied_rule_id가 빈 문자열이고 version은 0이다. builtin과 Docker 실행은 Rule 매칭 없이 독립적으로 확인할 수 있다. grounding 연결 후의 작성·검토 단계는 이 새 승인도 명시적 fresh context로 넘겨야 하며, metadata를 생략한 채 통과시키지 않는다. [OSS 계획](oss-repro-smoke-plan.md)의 분석·승인 fixture 가정과 충돌하지 않는다.

## 구현 상태와 확정한 내부 계약

- Decision의 applied_rule_id/version을 복원했다. 새 승인은 빈 문자열/0이며 누락을 새 승인으로 추정하지 않는다. scope/source_set_hash/projection_sha256도 review에서는 필수 바인딩으로 검사한다.
- Rule과 Scope를 추가하고 ComposeFactPackInput.rules를 요구한다. Scope의 다섯 wire 필드는 유지했다. F06이 추가로 요구하는 goal_variant는 wire에 없으므로 ReviewGroundingContext.rule_goals로 rule id/version/goal을 서버가 명시적으로 결합한다. 재사용 결정에 이 결합이 없거나 현재 task goal과 다르면 거부한다.
- groundFacts(context, pack, now)는 composition 입력에서 pack을 다시 만들고 현재 fact/slot/tool-result와 대조해 FactGrounding을 만든다. 이 요약만 넘겨서 권한으로 사용할 수는 없다. Core는 공개 projection의 실제 JSON 바이트 hash도 다시 계산한다.
- Engine.review의 세 번째 인수와 RealCore.writeReviewed의 grounding 옵션으로 현재 스냅샷을 전달한다. 누락·모순은 모델 호출 전 needs_decision/NEEDS_DISCLOSURE_DECISION이며 writeReviewed는 빈 draft와 거부 review를 반환한다. 독립 write는 내부 초안 생성 함수이고 최종 문서 승인 API가 아니다.
- exact_value/approved_excerpt/실제값 selected_fields의 재사용, 자유 요약의 재사용, 미등록 transform·잘못된 parameters는 거부한다. 현재 필요한 최소 변환만 허용하며 완전한 F06 적용 엔진을 구현했다고 표시하지 않는다.
- 검토 입력에는 검증한 fact/decision/rule 판본 요약만 추가한다. writer에는 rule/scope/원자료를 전달하지 않는다. 수정 피드백도 기존 fixed code와 검증한 fact/block ID만 유지한다.
- 단계 시작·검토 응답 채택·수정 시작 전에 현재 clock으로 만료를 검사한다. 실행 중 DB의 철회·revision 변경을 다시 읽고 CAS로 채택하는 책임은 여전히 서버에 있다.
- 기존 Core.generate HTTP 계약은 유지한다. 이 좁은 API는 호출자가 이미 승인한 facts를 제공하는 기존 신뢰 경계이며, 그 요청만 명시적인 fresh context로 변환한다. review에 근거가 없을 때 자동 fresh로 간주하는 fallback은 없다. 내부 task 원자료·과거 결정의 자동 이전 경로도 추가하지 않았다.

검증은 새 승인/유효한 재사용의 양성 사례, metadata 누락/변조, 오래된 preview, source/scope/goal/selector/version 불일치, 금지 표현 종류, 모든 판본 철회, 검토 중 만료의 음성 사례를 포함한다. 거부 사례는 pass를 반환하는 모델을 두어도 호출 수 0인지 검사한다. 서버 Rule 저장·매칭·UI는 이 테스트의 완료 주장에 포함하지 않는다.
