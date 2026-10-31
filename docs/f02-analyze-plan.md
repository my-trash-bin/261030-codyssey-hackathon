# F02 `analyze()` — 역할·계약·구조 (구현 전 정리)

## 왜 지금 계약부터인가

`docs/features/02-evidence-analysis.md`(F02 구현 명세 초안)는 `evidence_refs`/`need_keys`처럼
실제 `contracts/*.schema.json`과 다른 이름을 쓴다 — 보존한 과거 설계라 와이어 계약의 권위가
아니다. 이번 정리는 `contracts/candidate_proposals.v1.schema.json`과 `contracts/task.v1.schema.json`의
`sources`/`evidence`/`candidates` 하위 스키마를 직접 읽고 대조해, core-interface의 타입을 실제
계약에 맞춘 뒤에 로직을 짠다.

## 고친 것 (이번에 커밋)

`packages/core-interface/src/workflow.ts`의 `SourceDocument`/`EvidenceLocator`/`EvidenceSpan`이
`task.v1`과 달랐다 — 이 타입들은 지금까지 `analyze()` 스텁 시그니처에서만 쓰여서(grep으로 확인,
다른 실사용 없음) 고쳐도 아무것도 깨지지 않는다.

| 필드 | 이전(1라운드) | 고친 것 | 근거 |
| --- | --- | --- | --- |
| evidence의 source 참조 | `source_id` | `source_version_id` | `task.v1.evidence[].source_version_id` |
| evidence의 byte 범위 | `locator.start`/`locator.end` | `EvidenceSpan.start`/`end`(최상위) | `task.v1.evidence[]`는 start/end가 locator 밖 |
| locator의 선택 필드 | `start,end,row,column,pointer` | `column,pointer,row,value_sha256` | `task.v1.evidence[].locator`의 실제 optional 필드 |
| SourceDocument | `id,format,display_name,raw_bytes` | `id,source_id,version,display_name,format,source_slot,raw_bytes,sha256,included` | `task.v1.sources[]` 전체 필드 |

`Candidate`(모델 응답, `candidate_proposals.v1`)는 이미 정확했다 — 다만 `task.v1`에 있는
**서버가 영속화할 때의 더 넓은 candidate 모양**(`id`(서버 발급), `selector`, `origin`,
`conflict_group`/`conflict_reason`, `required`(boolean), `kind`에 F07 도구가 추가하는
`series/timeline/synthetic/config_example`까지 포함)과는 다른, 모델이 돌려주는 좁은 모양이라는
걸 주석으로 명확히 했다. 둘을 같은 타입으로 섞지 않는다.

## 역할 경계 (F02 §2·§5 기준)

| 하는 일 | 주체 |
| --- | --- |
| 원자료 형식별 결정적 위치 추적(byte_range/csv_cell/json_pointer) + evidence_sha256/value_sha256 계산 | **Engine**(`RealCore.analyze()`) |
| analyst 역할 LLM 호출, `candidate_proposals.v1` strict 검증, evidence_ids가 실제 만든 evidence 안에 있는지 확인 | **Engine** |
| job snapshot(scope/source/rule/pack 고정), DB lock, 모델 호출 | **server** — Engine은 호출 시점의 snapshot을 받기만 함 |
| 영속 candidate ID 발급, selector/origin/conflict_group 부여, candidate_set 생성 | **server** |
| 재분석 시 revision 증가·기존 candidate_set 무효화, CAS 채택 | **server** |
| 모델 호출 없는 수동 후보 추가(`AddManualCandidate`) | **server** — Engine을 전혀 거치지 않는 경로 |
| rule 자동 적용(F06) | F06 범위, 이번에 포함 안 함 — F02 §10 구현 순서도 "rule 연결"을 live adapter 뒤로 둔다 |

**`AnalyzeRequest`에 현재 팩/rule을 넣지 않은 이유**: F02 §10의 공식 구현 순서가 "근거 parser →
strict 후보 검증 → 수동 후보 → snapshot/CAS → fixture 분석 → live adapter → **rule 연결**"
이다 — rule/pack 연동은 스펙 자체가 live adapter보다 뒤에 두는 단계라, 지금 빼는 게 임의 축소가
아니라 스펙이 요구하는 순서다.

## 다음 라운드에서 만들 구조 (이번엔 타입만, 로직은 아직)

| 파일 | 내용 | 비고 |
| --- | --- | --- |
| `packages/core/src/evidence-parser.ts`(신규) | format별 결정적 파서. txt/log/md는 UTF-8 byte range(문자 경계 보존), csv는 row/column, json은 JSON Pointer. 전부 evidence_sha256/value_sha256 계산 | `node:crypto` 필요 — core-interface가 아니라 core에 두는 이유는 `skillSetHash`와 같음 |
| `packages/core/src/validation.ts`(확장) | `parseCandidateProposals(text, evidence)` — `parseDraft`/`parseReview`와 같은 패턴. 모델이 모르는 evidence_id·중복 local_key·conflict 참조 오류를 strict 거부 | AC-F02-04/06 대응 |
| `packages/core/src/index.ts`의 `RealCore.analyze()` | `evidence-parser`로 전체 source 파싱 → analyst 프롬프트 호출 → `parseCandidateProposals`로 검증 → `{evidence, proposals}` 반환 | `write()`/`review()`와 같은 `this.call()` 재시도 경로 재사용 |

## 이번에도 안 하는 것

- 실제 파서/프롬프트/검증 로직 구현 — 다음 라운드.
- server의 job/candidate_set/revision 저장 — 별도 범위, `task-store.ts` 확장 필요.
- rule 연결(F06) — F02 스펙도 뒤 단계로 둠.
- F07 roleDocuments를 analyst 프롬프트에 섞는 것 — 이전에 식별한 별도 계약 확장, 아직 미결.
