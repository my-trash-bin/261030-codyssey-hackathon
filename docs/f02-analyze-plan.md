# F02 `analyze()` - 역할/계약/구조와 Engine 구현 상태

## 왜 지금 계약부터인가

`docs/features/02-evidence-analysis.md`(F02 구현 명세 초안)는 `evidence_refs`/`need_keys`처럼
실제 `contracts/*.schema.json`과 다른 이름을 쓴다 - 보존한 과거 설계라 와이어 계약의 권위가
아니다. 이번 정리는 `contracts/candidate_proposals.v1.schema.json`과 `contracts/task.v1.schema.json`의
`sources`/`evidence`/`candidates` 하위 스키마를 직접 읽고 대조해, core-interface의 타입을 실제
계약에 맞춘 뒤에 로직을 짠다.

## 앞선 계약 정리

`packages/core-interface/src/workflow.ts`의 `SourceDocument`/`EvidenceLocator`/`EvidenceSpan`이
`task.v1`과 달랐다 - 이 타입들은 지금까지 `analyze()` 스텁 시그니처에서만 쓰여서(grep으로 확인,
다른 실사용 없음) 고쳐도 아무것도 깨지지 않는다.

| 필드 | 이전(1라운드) | 고친 것 | 근거 |
| --- | --- | --- | --- |
| evidence의 source 참조 | `source_id` | `source_version_id` | `task.v1.evidence[].source_version_id` |
| evidence의 byte 범위 | `locator.start`/`locator.end` | `EvidenceSpan.start`/`end`(최상위) | `task.v1.evidence[]`는 start/end가 locator 밖 |
| locator의 선택 필드 | `start,end,row,column,pointer` | `column,pointer,row,value_sha256` | `task.v1.evidence[].locator`의 실제 optional 필드 |
| SourceDocument | `id,format,display_name,raw_bytes` | `id,source_id,version,display_name,format,source_slot,raw_bytes,sha256,included` | `task.v1.sources[]` 전체 필드 |

`Candidate`(모델 응답, `candidate_proposals.v1`)는 이미 정확했다 - 다만 `task.v1`에 있는
**서버가 영속화할 때의 더 넓은 candidate 모양**(`id`(서버 발급), `selector`, `origin`,
`conflict_group`/`conflict_reason`, `required`(boolean), `kind`에 F07 도구가 추가하는
`series/timeline/synthetic/config_example`까지 포함)과는 다른, 모델이 돌려주는 좁은 모양이라는
걸 주석으로 명확히 했다. 둘을 같은 타입으로 섞지 않는다.

## 역할 경계 (F02 section 2/section 5 기준)

| 하는 일 | 주체 |
| --- | --- |
| 원자료 형식별 결정적 위치 추적(byte_range/csv_cell/json_pointer) + evidence_sha256/value_sha256 계산 | **Engine**(`RealCore.analyze()`) |
| analyst 역할 LLM 호출, `candidate_proposals.v1` strict 검증, evidence_ids가 실제 만든 evidence 안에 있는지 확인 | **Engine** |
| job snapshot(scope/source/rule/pack 고정), DB lock, 모델 호출 | **server** - Engine은 호출 시점의 snapshot을 받기만 함 |
| 영속 candidate ID 발급, selector/origin/conflict_group 부여, candidate_set 생성 | **server** |
| 재분석 시 revision 증가/기존 candidate_set 무효화, CAS 채택 | **server** |
| 모델 호출 없는 수동 후보 추가(`AddManualCandidate`) | **server** - Engine을 전혀 거치지 않는 경로 |
| rule 자동 적용(F06) | F06 범위, 이번에 포함 안 함 - F02 section 10 구현 순서도 "rule 연결"을 live adapter 뒤로 둔다 |

**`AnalyzeRequest`에 현재 팩/rule을 넣지 않은 이유**: F02 section 10의 공식 구현 순서가 "근거 parser ->
strict 후보 검증 -> 수동 후보 -> snapshot/CAS -> fixture 분석 -> live adapter -> **rule 연결**"
이다 - rule/pack 연동은 스펙 자체가 live adapter보다 뒤에 두는 단계라, 지금 빼는 게 임의 축소가
아니라 스펙이 요구하는 순서다.

## 구현한 구조 (Engine 라운드)

| 파일 | 내용 | 비고 |
| --- | --- | --- |
| `packages/core/src/evidence-parser.ts` | format별 결정적 파서. txt/log/md는 UTF-8 byte range(문자 경계 보존), csv는 row/column, json은 JSON Pointer. 전부 evidence_sha256/value_sha256 계산 | `node:crypto` 필요 - core-interface가 아니라 core에 두는 이유는 `skillSetHash`와 같음 |
| `packages/core/src/validation.ts`(확장) | `parseCandidateProposals(text, evidence)` - `parseDraft`/`parseReview`와 같은 패턴. 모델이 모르는 evidence_id/중복 local_key/conflict 참조 오류를 strict 거부 | AC-F02-04/06 대응 |
| `packages/core/src/index.ts`의 `RealCore.analyze()` | `evidence-parser`로 전체 source 파싱 -> analyst 프롬프트 호출 -> `parseCandidateProposals`로 검증 -> `{evidence, proposals}` 반환 | `write()`/`review()`와 같은 `this.call()` 재시도 경로 재사용 |

## 이번에도 안 하는 것

- 원자료 분석 결과의 의미 정확도/누락/충돌 탐지 품질을 자동 성공으로 판정하는 시험. 이번 회귀는 구조/참조/범위/예산/취소만 검사한다.
- Engine 라운드에서 제외했던 server job/candidate_set/revision 저장은 아래 내부 서버 라운드로 구현했다. task HTTP/UI는 별도다.
- rule 연결(F06) - F02 스펙도 뒤 단계로 둠.
- F07 roleDocuments를 analyst 프롬프트에 섞는 것 - 이전에 식별한 별도 계약 확장, 아직 미결.


## Engine 구현 완료 범위 / 2026-10-31

파서, strict 후보 응답 검증, `RealCore.analyze()`와 로컬 HTTP ModelClient 연결을 구현했다.
모델은 `analysis` 역할의 새 호출만 받으며 도구/writer/공개 결정을 자동 실행하지 않는다.
`AnalyzeResult`는 서버에 채택하기 전의 evidence/proposals이며 영속 candidate ID나 공개 허가가 아니다.
당시 제외한 서버 snapshot/CAS/job/수동 후보는 아래 내부 서버 라운드에서 구현했다. Rule/roleDocuments/task HTTP/UI는 별도다.

### 파서와 한도

- source 배열은 포함 상태의 전체 snapshot만 받는다. 제외된 row를 조용히 필터링하지 않고 거부한다.
  최대 100개, 각각 256 KiB, 합계 1 MiB, evidence 합계 100개다. 넘치면 전체를 거부하며 잘라서 성공하지 않는다.
- source version ID 중복/version<1/비정규 base64/잘못된 UTF-8/SHA-256 불일치를 거부한다.
  파일/URL을 추가 조회하지 않는다. display_name은 경로가 아닌 데이터다.
- txt/log/md는 줄바꿈을 제외한 각 비어 있지 않은 줄을 UTF-8 byte 범위 `[start,end)`로 만든다.
  공백 줄은 바이트가 있으면 보존하고 원문 문자열을 trim하지 않는다.
- CSV는 첫 논리 행을 고유한 비어 있지 않은 열 이름으로 사용한다. locator.row는 헤더를 포함한
  1-based 논리 행 번호이므로 첫 데이터는 2다. 따옴표/escaped quote/여러 줄 셀/LF/CRLF를
  처리하고 열 수 불일치/잘못된 인용을 거부한다. byte 범위는 따옴표를 포함한 원래 셀 token이다.
  빈 unquoted 셀은 start=end이며 hash는 빈 바이트의 SHA-256이다. value hash는 인용 해제된 UTF-8 값이다.
- JSON은 scalar와 빈 object/array를 근거로 만들고, `/`/`~`를 escape한 JSON Pointer를 붙인다.
  root 값의 pointer는 빈 문자열이다. 중복/escape로 중복된 key/잘린 문법/lone surrogate/32 초과
  깊이를 거부한다. 문자열 value hash는 JSON escape를 해제한 UTF-8 값, 나머지는 정확한 원래
  literal 바이트다. 숫자를 JS Number로 변환해 정밀도를 잃지 않는다. 별도 selector 인증은 만들지 않는다.
- evidence hash는 원본 byte 범위의 SHA-256이다. ID는 source version ID/source hash/위치/
  locator의 결정적 hash로 만들어 같은 snapshot에서 안정적이며 다른 판본에는 이어지지 않는다.

### 후보 응답과 호출

`candidate_proposals.v1` 예제와 대조한다. 중복 JSON key/알 수 없는 필드/enum/type/후보 30개
초과/중복 local_key/알 수 없는 evidence ID/잘못된 conflict 참조를 거부한다. conflict는 서로
다른 후보 둘 이상이며 같은 그룹을 순서만 바꿔 중복할 수 없다. wire에서 허용하는 nullable array는
Engine의 배열 계약에 맞춰 []로 정규화한다. 텍스트는 8192 Unicode code point 한도이며 잘못된
surrogate를 거부한다. 빈 statement/local_key/중복 evidence 참조도 거부한다.

모델 입력 직렬화 크기를 provider.max_input_bytes와 사전 대조하고, 실제 HTTP body는 기존
adapter가 다시 검사한다. timeout/잘못된 구조 응답의 단계별 재시도와 실행 내 호출 수 상한은
기존 this.call 경로를 사용한다. 취소 전/응답 직후 모두 검사하며 부분 결과를 반환하지 않는다.
오류는 INVALID_CORE_INPUT 또는 기존 ModelError/CoreError 코드로 전달하고 HTTP 계약은 바꾸지 않았다.

### transcript와 검증

분석의 run_started/analysis_parsed/model_started/model_completed/analysis_completed/run_completed
또는 실패 이벤트만 남긴다. 내용 opt-in을 켜도 원자료/파일명/분석 prompt/후보 statement를
transcript에 저장하지 않는다. 분석 결과는 자동으로 writer나 새 승인 요청에 전달되지 않는다.

결정적 회귀는 UTF-8 byte/hash/CSV/JSON 경계/source 바인딩/후보 예제/참조/중복/한도/재시도/
호출 예산/취소/원문 로그 비기록을 검사한다. app 통합 시험은 node:http 로컬 목 서버에서 실제
호환 HTTP adapter까지 연결한다. 실제 외부 모델 호출이나 의미 정확도 평가는 하지 않았다.

## HTTP 라우트 연결 / 2026-10-31

`POST /api/analysis`를 추가했다(`packages/server/src/app.ts`). `/api/sharing`과 같은 패턴
(동기 호출, `response.close` -> `AbortController` 취소, content-type 검사)을 따른다. `createApp`은
세 번째 선택 인자 `engine?: Engine`을 받는다 - `fake-core`가 `Engine`을 구현하지 않으므로
`core`(`Core`)와 분리했다. `engine`이 없으면(가짜 앱 등) 503 `CORE_NOT_IMPLEMENTED`를 반환한다.
`analyze()` 자체가 모델 호출 전 전체 입력을 strict 검증하므로 라우트에서 별도 wire parser를
만들지 않았다. 요청 본문 상한은 base64 확장(약 4/3배)을 고려해 1.5 MiB로 analyze 전용으로 뗐다
(다른 라우트는 1 MiB 그대로).

**실제 모델로 라우트를 시험하다가 코드 버그를 하나 발견해 고쳤다**: `analyze()`는 `generate()`와
달리 `ModelError`를 `CoreError`로 변환하지 않고 그대로 던진다(기존 단위테스트가 이 동작을
명시적으로 기대함 - `analyze()` 자체는 건드리지 않음). 그런데 `app.ts`의 catch가 `CoreError`만
인식해서 `ModelError`가 500 `STORAGE_FAILED`로 잘못 매핑됐다. HTTP 경계에 `ModelError` 처리를
추가해 503과 실제 코드(`MODEL_INVALID_RESPONSE` 등)를 반환하도록 고쳤다.

**별개로 발견한, 고치지 않은 것**: 같은 실제 테스트에서 실제 등록 모델이 analysis 역할에
`finish_reason=length`로 응답이 끊겼다 - `usage.total_tokens`가 `prompt_tokens+completion_tokens`
보다 훨씬 크고 `max_output_tokens`(config.json)에 가까워서, 보이지 않는 reasoning 토큰이
출력 예산을 거의 다 쓴 것으로 보인다. 이건 모델/설정 튜닝 문제이고 공유 `config.json`의
`provider.max_output_tokens`는 모든 역할(write/review도)에 적용되는 값이라 제가 임의로
올리지 않았다 - 비용/지연에 영향을 주는 판단이라 확인이 필요하다.

## 다음 내부 서버 라운드의 코딩 전 범위 축소

기존 TaskStore를 확장하되 task/decision HTTP API는 추가하지 않는다. 기존 documents/결정/
미리보기 레코드를 보존하는 additive migration으로 source version/현재 source 선택/근거/
분석 job/후보 provenance만 추가한다. 전체 task.v1을 구현하는 라운드가 아니다.

1. 서버가 실제 source 바이트를 검증/저장하고 source_set_hash를 계산한다. 동일 version ID의
   바이트/metadata 수정은 거부한다. source 교체는 revision을 올리고 현재 후보/결정 포인터를 비운다.
2. 모델 없는 수동 후보는 현재 근거 또는 새 user_note에 묶는다. 현재 후보는 새 영속 ID로 복제하고
   선택은 복사하지 않는다. user_note/근거/새 후보 집합을 같은 트랜잭션에서 만들고 revision은 한 번만 올린다.
3. 분석 시작 시 source/context/skill hash와 revision을 고정하고 이전 현재 결과를 무효화한다.
   Engine 호출은 DB transaction 밖에서 수행한다. 성공 시 현재 revision/job 상태/source/skill
   바인딩과 근거 범위/hash/후보 참조를 확인한 뒤 원자적으로 새 집합을 채택한다.
4. 영속 후보 ID와 origin/conflict group은 서버가 부여한다. 검증된 selector는 아직 발급하지 않는다.
   취소/source/결정 변경/재분석/삭제 뒤 늦은 응답은 채택하지 않는다. 실패 결과를 현재 후보에 합치지 않는다.
5. 회귀는 모델 없는 수동 경로, rollback/재열기/migration 보존, 참조/판본 바인딩, 작업 간 치환,
   지연된 가상 Engine으로 CAS/취소/삭제를 결정적으로 검사한다. 의미 정확도와 live 모델 성공은 판정하지 않는다.

인증/CSRF/Host/Origin/task CRUD/UI/Rule/roleDocuments/artifact/export 무효화의 전체 연결은
이번에 포함하지 않는다. HTTP 분석의 stateless 경로도 그대로 유지한다. 실제 모델의 length 종료는
공유 config를 임의 변경해 해결하지 않고 별도 역할별 예산/운영 검증 과제로 남긴다.

## 내부 서버 구현 완료 / 2026-10-31

`TaskStore.analysis`와 `runTaskAnalysis`를 추가했다. additive migration v2는 기존 documents와
v1 후보/미리보기/결정을 보존한다. 새로 추가한 것은 다음 내부 레코드다.

| 레코드 | 보관 범위 |
| --- | --- |
| workflow_source_versions / workflow_source_selections | 불변 source version과 현재 included snapshot |
| workflow_evidence | source version에 묶인 근거와 정확한 byte 범위/hash |
| workflow_analysis_jobs | immutable source/context/skill snapshot/revision, running/succeeded/failed/cancelled/stale |
| workflow_candidate_provenance | 서버 후보 ID에 연결된 원래 local_key/model/manual origin/서버 conflict group |

새 job은 서버 내부 분석 상태이며 전체 job.v1/스케줄러/작업 HTTP API가 아니다. 원자료와 분석
결과는 내부 DB에만 보관한다. TaskStore.delete는 새 레코드도 cascade로 지우며 이미 외부로
내보낸 파일이나 transcript 만료/삭제까지 새로 구현한 것은 아니다.

### 호출 순서

1. `store.analysis.replaceSources(taskId, revision, includedSources)`는 source hash/base64/UTF-8/
   판본을 검증한다. 현재 snapshot에는 논리 source당 판본 하나만 허용한다. 동일 ID와 동일
   논리 source/version은 불변이다. 바뀐 내용에는 새 version ID/version을 사용한다.
2. 서버가 source_set_hash를 계산하고 현재 후보/결정을 비운 뒤 revision을 한 번 올린다.
   source는 최대 100개/각 256 KiB/합계 1 MiB이고 빈 선택은 저장 가능하나 분석은 시작하지 못한다.
3. `runTaskAnalysis(store, engine, taskId, revision, {signal})`은 start를 commit하고 DB lock 없이
   Engine을 호출한다. 결과를 채택할 때 job 상태/revision/source/skill/context를 다시 대조한다.
4. 범위와 원본 slice hash/셀/JSON value hash/source 소속/후보/충돌 참조를 확인하고, evidence/새 후보 집합/provenance/
   job 성공을 같은 트랜잭션에 저장한다. 영속 ID와 conflict group ID는 서버가 발급한다.
   채택 반환값의 job은 snapshot을 제외한 요약이며 원자료를 다시 포함하지 않는다.
   CSV/JSON locator의 해석은 Engine 파서의 책임이며 이 저장 검사를 verified selector 발급으로
   간주하지 않는다. 반환되는 selector는 항상 null이다.
5. 오래된 revision이나 취소된 job의 complete는 adopted=false이며 현재 결과를 바꾸지 않는다.
   삭제된 job은 ANALYSIS_NOT_FOUND이고 다시 생성하지 않는다. 실패 코드는 고정 목록만 저장하고
   임의 오류 메시지는 저장하지 않는다. 분석 시작/수동 변경은 기존 공개 결정을 이어받지 않는다.

`store.analysis.start/job/cancel/complete`는 내부 호출용이다. `candidates`는 서버 ID와 원래
local_key를 구분하고 `evidence`는 현재 선택한 source에 속한 근거만 조회한다. 예전
installCandidates seam으로 만든 후보에는 provenance/실제 source가 없으므로 새 F02 경로에서
신뢰하지 않는다. 원래 저장/결정 기능은 보존하고 새 source snapshot에서 재분석해야 한다.

### 모델 없는 수동 경로

`store.analysis.addManual(taskId, revision, {candidate, evidence_ids})` 또는 `{candidate,user_note}`를
호출한다. 둘 중 하나만 받으며 빈 근거/다른 source 근거는 거부한다. user_note이면 서버가 새
source version과 byte_range evidence를 발급한다. 기존 현재 후보는 새 영속 ID로 복제하고 새
수동 후보를 추가한다. 선택/승인은 복제하지 않는다. 전체 작업은 한 트랜잭션, revision 증가는
한 번, 결과 phase는 needs_decisions다. Engine이 없거나 모델 실패 상태여도 이 경로는 사용 가능하다.

### 검증과 남은 범위

임시 SQLite에서 v1 migration 보존/재열기/불변 snapshot/원자적 rollback/작업 간 참조 치환/
UTF-8 중간 범위 거부/새 ID/결정 비승계/취소/실패/삭제/재분석 뒤 늦은 응답을 검사한다.
지연된 가상 Engine 중에도 source 교체가 가능해 모델 호출 동안 transaction이 없음을 확인한다.
app 통합 시험은 실제 RealCore 파서 -> 로컬 HTTP 모델 adapter -> TaskStore 채택까지 연결한다.
의미 정확도/실제 외부 모델 성공을 이 테스트로 판단하지 않는다.

HTTP 분석은 여전히 stateless이고 새 내부 job 저장에 자동 연결하지 않았다. 인증/CSRF/Host/Origin/
task CRUD/수동 후보 UI/Rule/roleDocuments/팩 변경 무효화/artifact/export 전체 연결은 후속이다.
실제 모델의 length 종료/역할별 출력 예산 문제는 이번에 변경하지 않았다.


## UI 요청 후속 HTTP 연결

[UI 요청 현황](ui-api-requests.md)에 따라 인증된 task/source/분석 job/CAS/수동 후보 HTTP를
구현했다. 앞의 task HTTP 제외 문구는 내부 저장 라운드 당시 범위다. stateless `/api/analysis`는
그대로이며 현재 UI를 영속 저장에 자동 연결하지 않는다. [실제 API](api.md)를 따른다.
