# F02 `analyze()` — 역할·계약·구조와 Engine 구현 상태

## 왜 지금 계약부터인가

`docs/features/02-evidence-analysis.md`(F02 구현 명세 초안)는 `evidence_refs`/`need_keys`처럼
실제 `contracts/*.schema.json`과 다른 이름을 쓴다 — 보존한 과거 설계라 와이어 계약의 권위가
아니다. 이번 정리는 `contracts/candidate_proposals.v1.schema.json`과 `contracts/task.v1.schema.json`의
`sources`/`evidence`/`candidates` 하위 스키마를 직접 읽고 대조해, core-interface의 타입을 실제
계약에 맞춘 뒤에 로직을 짠다.

## 앞선 계약 정리

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

## 구현한 구조 (Engine 라운드)

| 파일 | 내용 | 비고 |
| --- | --- | --- |
| `packages/core/src/evidence-parser.ts` | format별 결정적 파서. txt/log/md는 UTF-8 byte range(문자 경계 보존), csv는 row/column, json은 JSON Pointer. 전부 evidence_sha256/value_sha256 계산 | `node:crypto` 필요 — core-interface가 아니라 core에 두는 이유는 `skillSetHash`와 같음 |
| `packages/core/src/validation.ts`(확장) | `parseCandidateProposals(text, evidence)` — `parseDraft`/`parseReview`와 같은 패턴. 모델이 모르는 evidence_id·중복 local_key·conflict 참조 오류를 strict 거부 | AC-F02-04/06 대응 |
| `packages/core/src/index.ts`의 `RealCore.analyze()` | `evidence-parser`로 전체 source 파싱 → analyst 프롬프트 호출 → `parseCandidateProposals`로 검증 → `{evidence, proposals}` 반환 | `write()`/`review()`와 같은 `this.call()` 재시도 경로 재사용 |

## 이번에도 안 하는 것

- 원자료 분석 결과의 의미 정확도·누락/충돌 탐지 품질을 자동 성공으로 판정하는 시험. 이번 회귀는 구조·참조·범위·예산·취소만 검사한다.
- server의 job/candidate_set/revision 저장 — 별도 범위, `task-store.ts` 확장 필요.
- rule 연결(F06) — F02 스펙도 뒤 단계로 둠.
- F07 roleDocuments를 analyst 프롬프트에 섞는 것 — 이전에 식별한 별도 계약 확장, 아직 미결.


## Engine 구현 완료 범위 · 2026-10-31

파서, strict 후보 응답 검증, `RealCore.analyze()`와 로컬 HTTP ModelClient 연결을 구현했다.
모델은 `analysis` 역할의 새 호출만 받으며 도구·writer·공개 결정을 자동 실행하지 않는다.
`AnalyzeResult`는 서버에 채택하기 전의 evidence/proposals이며 영속 candidate ID나 공개 허가가 아니다.
서버 snapshot/CAS·job·수동 후보·Rule·roleDocuments·HTTP/UI 연결은 여전히 별도다.

### 파서와 한도

- source 배열은 포함 상태의 전체 snapshot만 받는다. 제외된 row를 조용히 필터링하지 않고 거부한다.
  최대 100개, 각각 256 KiB, 합계 1 MiB, evidence 합계 100개다. 넘치면 전체를 거부하며 잘라서 성공하지 않는다.
- source version ID 중복·version<1·비정규 base64·잘못된 UTF-8·SHA-256 불일치를 거부한다.
  파일·URL을 추가 조회하지 않는다. display_name은 경로가 아닌 데이터다.
- txt/log/md는 줄바꿈을 제외한 각 비어 있지 않은 줄을 UTF-8 byte 범위 `[start,end)`로 만든다.
  공백 줄은 바이트가 있으면 보존하고 원문 문자열을 trim하지 않는다.
- CSV는 첫 논리 행을 고유한 비어 있지 않은 열 이름으로 사용한다. locator.row는 헤더를 포함한
  1-based 논리 행 번호이므로 첫 데이터는 2다. 따옴표·escaped quote·여러 줄 셀·LF/CRLF를
  처리하고 열 수 불일치·잘못된 인용을 거부한다. byte 범위는 따옴표를 포함한 원래 셀 token이다.
  빈 unquoted 셀은 start=end이며 hash는 빈 바이트의 SHA-256이다. value hash는 인용 해제된 UTF-8 값이다.
- JSON은 scalar와 빈 object/array를 근거로 만들고, `/`·`~`를 escape한 JSON Pointer를 붙인다.
  root 값의 pointer는 빈 문자열이다. 중복/escape로 중복된 key·잘린 문법·lone surrogate·32 초과
  깊이를 거부한다. 문자열 value hash는 JSON escape를 해제한 UTF-8 값, 나머지는 정확한 원래
  literal 바이트다. 숫자를 JS Number로 변환해 정밀도를 잃지 않는다. 별도 selector 인증은 만들지 않는다.
- evidence hash는 원본 byte 범위의 SHA-256이다. ID는 source version ID·source hash·위치·
  locator의 결정적 hash로 만들어 같은 snapshot에서 안정적이며 다른 판본에는 이어지지 않는다.

### 후보 응답과 호출

`candidate_proposals.v1` 예제와 대조한다. 중복 JSON key·알 수 없는 필드·enum/type·후보 30개
초과·중복 local_key·알 수 없는 evidence ID·잘못된 conflict 참조를 거부한다. conflict는 서로
다른 후보 둘 이상이며 같은 그룹을 순서만 바꿔 중복할 수 없다. wire에서 허용하는 nullable array는
Engine의 배열 계약에 맞춰 []로 정규화한다. 텍스트는 8192 Unicode code point 한도이며 잘못된
surrogate를 거부한다. 빈 statement/local_key·중복 evidence 참조도 거부한다.

모델 입력 직렬화 크기를 provider.max_input_bytes와 사전 대조하고, 실제 HTTP body는 기존
adapter가 다시 검사한다. timeout·잘못된 구조 응답의 단계별 재시도와 실행 내 호출 수 상한은
기존 this.call 경로를 사용한다. 취소 전·응답 직후 모두 검사하며 부분 결과를 반환하지 않는다.
오류는 INVALID_CORE_INPUT 또는 기존 ModelError/CoreError 코드로 전달하고 HTTP 계약은 바꾸지 않았다.

### transcript와 검증

분석의 run_started/analysis_parsed/model_started/model_completed/analysis_completed/run_completed
또는 실패 이벤트만 남긴다. 내용 opt-in을 켜도 원자료·파일명·분석 prompt·후보 statement를
transcript에 저장하지 않는다. 분석 결과는 자동으로 writer나 새 승인 요청에 전달되지 않는다.

결정적 회귀는 UTF-8 byte/hash·CSV/JSON 경계·source 바인딩·후보 예제·참조/중복/한도·재시도·
호출 예산·취소·원문 로그 비기록을 검사한다. app 통합 시험은 node:http 로컬 목 서버에서 실제
호환 HTTP adapter까지 연결한다. 실제 외부 모델 호출이나 의미 정확도 평가는 하지 않았다.
