# F03 공개 결정 — 역할·계약·구조

현재 상태: UI 요청에 따라 서버 세션·task/job·미리보기·조건 해석·결정 HTTP와 C 변환을 구현했다.
현행 계약은 [실제 API](api.md), 지원 한도와 남은 UI는 [요청 현황](ui-api-requests.md)을 따른다.
아래 내용은 그 이전 타입 정리 라운드의 계획 기록이다. 타임라인·원문 예외·Rule은 여전히 별도다.

F02와 같은 방식: 먼저 계약을 실제 wire 스키마와 맞추고, 역할 경계와 다음 구조를 정리한다.
`proposeDisclosure`/`preview`의 실제 로직은 이번에 구현하지 않는다.

## 고친 것 (이번에 커밋)

`DisclosurePreview`가 `contracts/disclosure_preview.v1.schema.json`의 필수 필드
`raw_grants`를 빠뜨리고 있었다(nullable wire 배열 → 이 프로젝트 관례대로 `[]`로 정규화해
내부 타입에서는 항상 배열). 새 `RawGrant`/`ByteRange` 타입을 추가했다 — F03 §5 "원문 구간
허용은 source_version_id, source hash, UTF-8 경계 byte range, 실제 공개 형태의 hash, scope,
expiry에 결합한다"를 그대로 반영한다. `approved_excerpt`가 아닌 미리보기는 빈 배열이다.

`ModelRole`에 `'disclosure'`를 추가했다(`proposeDisclosure`가 쓸 역할). `fresh-grounding.ts`,
`test-fixtures.ts`, `task-store.ts`, `workflow.test.ts`가 만드는 기존 `DisclosurePreview`
리터럴에 `raw_grants: []`를 채웠다 — 전부 `fact_summary`라 원문 허용이 없다. `pnpm typecheck`가
이 네 곳을 빠짐없이 잡아줬다(타입을 필수로 바꾼 효과).

## 먼저 바로잡은 것: server 쪽은 이미 상당히 되어 있다

이전 라운드 정리에서 "server task/decision 저장은 미구현"이라고 썼는데, `TaskStore`
(`packages/server/src/task-store.ts`, 185줄)를 다시 보니 틀렸다. 이미 있다:

| 메서드 | 하는 일 |
| --- | --- |
| `create` | task 생성, context/source_set_hash/skill_set_hash 저장 |
| `installCandidates` | candidate_set 원자적 교체, revision 증가, phase→needs_decisions |
| `preview` | **`fact_summary`만** — 호출자가 준 `statement`를 그대로 저장하고 hash 계산 |
| `applyDecisionBatch` | **원자적·멱등** 배치(Idempotency-Key, F03 §동시성과 정확히 일치), preview/scope/source hash 대조, allow만 preview 참조 필수 |
| `decisions`/`effectiveAllows`/`revoke`/`delete` | 현재 결정 조회, 유효 allow만 필터, 철회, 삭제 |

빠진 건 두 가지뿐이다: **(1) 이걸 부르는 HTTP 라우트가 없다**(`app.ts`/`main.ts` 어디서도
`TaskStore`를 import하지 않음, grep으로 확인). **(2) `preview()`가 `fact_summary` 말고는
아무것도 계산하지 못한다** — 호출자가 문장을 직접 줘야 해서, 사실상 "이 문장을 불변으로
저장"일 뿐 F03이 말하는 "지원 representation과 매개변수를 검증하고 실제 공개 projection을
계산"하는 쪽이 아니다.

## 핵심 발견: `preview()`의 계산은 F07 builtin 도구를 그대로 쓸 수 있다

`packages/core/src/transforms.ts`의 `deriveSeries`/`renderTimeline`/`renderApprovedExcerpt`가
정확히 F03 §3의 A/B/D 표가 요구하는 계산이다:

| F03 표현 | 기존 builtin 함수 |
| --- | --- |
| A(fact_summary), B(`series_direction_only.v1`의 derived_table), D(`series_index_base100.v1`) | `deriveSeries` |
| 타임라인 표현(`sequence_only`/`relative_intervals`/`shifted_absolute`/`synthetic_schedule`) | `renderTimeline` |
| `approved_excerpt` | `renderApprovedExcerpt` — 반환값이 그대로 `raw_grants`/`projection.excerpt`의 재료다 |

단, **`Engine.preview()`는 `createBuiltinTools()`의 grant 검사 래퍼를 거치지 않고
`transforms.ts`의 순수 함수를 직접 불러야 한다** — grant는 "모델이 이미 승인된 도구를
호출했다"는 걸 증명하는 장치인데, 미리보기는 아직 승인 전 단계(F03 §3: "선택지 클릭은
미리보기 요청이다")라 grant 자체가 존재하지 않는다. `tool_request.v1` envelope도 필요 없다.

**빈 자리**: C(`selected_fields`)와 `exact_value`는 대응하는 builtin 함수가 없다. 복잡한
계산이 없고(승인한 필드/값을 그대로 옮기는 수준) 다음 라운드에서 작은 함수를 새로 추가하면
된다 — 계획에만 적어두고 이번엔 만들지 않는다.

## 역할 경계

| 하는 일 | 주체 |
| --- | --- |
| candidate 하나를 보고 지원 representation·근거·명확화 필요 여부 제안(`DisclosureProposal`) | **Engine**(`proposeDisclosure`, 새 `disclosure` 역할 LLM 호출) — 결정 생성/승인/규칙 활성화는 못 함(F03 §2) |
| representation+candidate로 실제 projection 계산(`DisclosurePreview`) | **Engine**(`preview`) — `transforms.ts` 직접 호출, LLM 없음, grant 없음 |
| projection을 불변 저장, hash·scope·source 결합 기록 | **server**(`TaskStore.preview`) — representation 계산 결과를 받아 저장하는 쪽으로 넓혀야 함 |
| 결정 배치 적용(원자적·멱등), 현재 포인터 교체, 철회·만료 | **server**(`TaskStore.applyDecisionBatch`/`revoke`) — 이미 구현됨, 안 바꿔도 됨 |
| HTTP 노출 | **아무도** — 이번에도 라우트를 추가하지 않는다 |

## 다음 라운드에서 만들 구조 (이번엔 타입만)

| 파일 | 내용 |
| --- | --- |
| `packages/core/src/validation.ts`(확장) | `parseDisclosureProposal(text)` — `parseCandidateProposals`와 같은 패턴. `disclosure_proposal.v1` strict 검증 |
| `packages/core/src/index.ts`의 `proposeDisclosure` | `disclosure` 역할 LLM 호출 + 검증. candidate 하나만 보내고 task 전체나 다른 candidate는 안 보냄(F03 §2 "모델은 ... 다른 작업을 읽지 못한다"와 같은 원칙) |
| `packages/core/src/index.ts`의 `preview` | `representation.kind`/`transform_id`로 `transforms.ts` 함수를 바로 호출. `selected_fields`/`exact_value`는 새 작은 함수 필요(이번엔 안 만듦) |
| `packages/server/src/task-store.ts`의 `preview` 시그니처 변경 | `(id, revision, candidateId, statement)` → `(id, revision, candidateId, representation, projection)`로 넓혀 Engine이 계산한 임의 projection을 저장하게 한다. 기존 fact_summary 전용 호출부(`task-store.test.ts`)도 같이 고쳐야 함 |
| HTTP 라우트 | task 생성/candidate 조회/미리보기 요청/결정 배치/철회 — 전부 아직 없음, 다음다음 라운드 |

## 이번에도 안 하는 것

- `proposeDisclosure`/`preview`의 실제 로직. `selected_fields`/`exact_value` builtin 함수.
- `TaskStore.preview()` 시그니처 변경(로직은 그대로 두고 계획만 적음).
- HTTP 라우트, UI 연결(`f03-ui-prerequisites.md`가 이미 10개 항목 정리해둠, 여전히 유효).
- F06 rule 연결(`review-grounding-plan.md`와 같은 이유로 보류).
- `Decision.raw_grants` 복원은 안 함 — 1라운드의 "서버 감사 필드 축소" 결정을 그대로 유지한다.
  `DisclosurePreview.raw_grants`만 이번에 필요해서 추가했다(Engine이 직접 만드는 값이라서).
