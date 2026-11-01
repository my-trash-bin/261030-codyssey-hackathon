# F08 / 새 합성 입력으로 관찰한 문제 확인하기

등급: P1 계획된 확장 검증 / 담당: 예시 환경/실행 담당 / 의존: F03-F05, F07, F10 / 연결: F09

이 파일은 [PRD](../product/prd.md) PRD-11, [spec](../design/spec.md), [확장 계약](../design/extensions.md)의 재현 기능을 구현할 기준이다. 아래 target/명령/패키지는 구현할 계약이며 이미 실행된 검증 결과를 뜻하지 않는다.

## 1. 목적

**실제 회사 데이터를 주지 않고도 수신자가 정한 오류를 직접 확인할 수 있는 자료를 준비한다.** 새 입력을 만들고 원래 조사 목적에 필요한 관찰이 남아 있는지 실행으로 확인한다. 성공한 예제는 수신자의 조사, 수정 전후 비교, 회귀 시험에 다시 사용할 수 있다.

이 기능은 준비된 실행 환경이 있을 때의 확장이다. 환경이 없는 B2B 문의도 관찰/미확인 사항/추가 조사 질문으로 완성할 수 있어야 한다. 재현 실패는 자동으로 공개 범위를 넓힐 근거가 아니다.

## 2. 쓰는 사람과 권한

인증된 사용자가 재현 목적/공개할 기술 특성/새 입력 생성/현재 패키지를 확인한다. 설치 담당자는 고정 target/runner/oracle과 digest를 등록한다. 모델은 기술 조건과 후보를 제안할 수 있지만 target 코드/oracle/실행 권한을 바꾸지 못한다.

원래 고객 값/원문/원래 길이/시간을 실행기에 자동 전달하지 않는다. 승인된 기술 특성과 공개 제품 계약으로 새 입력을 생성한다. 실행기는 원자료 DB, 평가 정답표, 수신자 전용 기록에 접근하지 않는다. 실제 원문 인용이 필요한 별도 문의는 F03의 원문 승인 경로를 사용한다.

## 3. 화면

| 화면 | 내용 | 실패/빈 상태 |
| --- | --- | --- |
| UI-02 입력 | 제품 팩 선택, 재현 환경 사용 가능 여부 | 없음이면 '관찰 자료로 문의 작성' 가능 |
| UI-03 작업 공간 | 새 입력 내용/기술 특성/실행 진행/네 결과 | not_run/not_reproduced/inconclusive/error 구분 |
| UI-04 공개 선택 | 어떤 입력 특성을 유지할지, 새 입력 공개 미리보기 | 정보 추가가 필요하면 선택 단계로 돌아감 |
| UI-06 최종 확인 | 공개 파일/재현 범위/미확인 사항/실행 방법 | '같은 근본 원인 확인'으로 확대 표시 금지 |

주요 버튼은 '새 예제로 확인', '입력 다시 선택', '관찰 자료로 문의 계속'이다. 진행 중에는 취소와 현재 단계가 보인다. 준비된 응답만으로 실행한 것처럼 보이는 애니메이션을 만들지 않는다. `fixture/live` LLM 모드와 실제 runner 실행 여부는 별도 표시한다.

재현되지 않은 경우 먼저 '환경 확인', '실패한 단계 확인', '다른 합성 입력 선택', '필요 정보 다시 선택'을 제안한다. 사용자 확인 없이 실제 회사 데이터나 원문을 더 넣지 않는다. 정보가 부족할 때의 UI-03 -> UI-04 복귀가 서비스의 정상 경로다.

## 4. 데이터

| 대상 | 읽는 내용 | 쓰는 내용 |
| --- | --- | --- |
| 등록 팩/target | 입력 계약, 대상 pair, oracle, 실행 파일/이미지 digest | runtime 변경 금지 |
| `decisions`, `fact_packs` | 승인된 기술 특성/합성 입력 조건 | 원자료로 자동 확대 금지 |
| `tool_runs` | 현재 revision/도구 판본 | 입력 hash, 정형 실행 결과, 내부 진단 |
| `jobs` | task revision, snapshot, current job | running/실패/취소/완료 |
| `artifacts`, `artifact_files` | 현재 공개 결과 | 새 입력/공개 runner/실행 요약 파일 |
| `reviews`, `findings` | 현재 결과 hash | 재현 결과가 포함된 새 파일 집합 검토 |
| `events` | 진행 이력 | 단계/상태 변화 |

재현 상태는 task phase와 분리한다. `goal_variant=default` 또는 `observations_only`에서는 `task.phase=ready_to_finalize`, `reproduction.status=not_run`, `reason_code=no_environment`가 동시에 가능하다. `goal_variant=reproduction_evidence`는 현재 목표에서 `reproduced`가 완료 조건이므로 환경 없음이나 재현 실패를 목적 달성으로 표시할 수 없다. 실행 결과를 추가한 후에는 F05의 실제 파일 검토가 다시 필요하다.

## 5. 규칙과 예시 환경

적용 불변조건은 INV-03-09/13-16이다.

### 5.1 고정 toy 대상

가상 `toyrecord`는 UTF-8 JSON `{"value":"문자열"}`을 받아 파일로 저장한다. 입력은 `value` 하나만 허용하고 문자열 길이는 1-8 코드포인트다. 중복 키/추가 키/잘못된 타입/잘못된 JSON/후행 JSON은 거부한다.

처리 순서는 parse -> validate -> encode -> persist다. 결함 버전은 코드포인트 수만큼 바이트 버퍼를 잡아 UTF-8 바이트 길이가 더 크면 `E_ENCODE_SHORT_BUFFER`를 반환한다. 수정 버전은 UTF-8 바이트 길이로 버퍼를 잡는다. 성공하면 `result.bin`에 문자열의 UTF-8 바이트만 쓴다. 이 대상은 기능 검증을 위해 의도적으로 만든 예제이며 실제 오픈소스 라이브러리의 발견된 버그로 발표하지 않는다.

| 입력 | buggy | fixed |
| --- | --- | --- |
| `{"value":"ABCDEF"}` | persist 성공, 파일 일치 | persist 성공, 파일 일치 |
| `{"value":"가나다라마바"}` | encode 오류, 파일 없음 | persist 성공, 파일 일치 |
| `{"value":"ABCDEFGHI"}` | validate / E_INPUT_LIMIT | 동일 |
| `{"value":""}` | validate / E_INPUT_LIMIT | 동일 |
| `{` | parse / E_INPUT_PARSE | 동일 |

target stdout은 `target_run.v1` JSON 하나다. 필드는 `schema_version`, `status`, `stage`, `code`다. `status`는 `ok`, `domain_error`, `execution_error`; `stage`는 `parse`, `validate`, `encode`, `persist`다. 성공은 `ok/persist/code=null`, 예기치 않은 실행 오류는 `execution_error/E_EXECUTION`이다. exit code는 성공 0, 예상 도메인 오류 2, 예기치 않은 실행 오류 3이다. exit code/JSON 불일치나 파싱 실패는 runner 오류다.

파일 존재와 정확한 바이트 일치는 runner가 직접 검사한다. target의 '성공' 문자열만 믿지 않는다. 매 실행은 새 빈 출력 디렉터리를 사용한다. 이전 실행의 파일이 성공 조건을 만족시키지 않게 한다.

### 5.2 새로운 입력 생성

`make_synthetic_inputs_v1`의 입력은 공개 target 계약, 문자 종류, `codepoint_count`, seed다. 기본 길이는 공개 계약에서 정한 6이며 허용 범위는 1-8이다. 같은 길이의 ASCII 정상 비교 입력과 다중 바이트 한글 후보를 만든다.

시연 원자료의 실패값은 7코드포인트이고 새 입력은 기본 6코드포인트다. 새 입력을 원래 고객 데이터의 가명 치환이라고 설명하지 않는다. seed는 공개 가능한 실행 재현 정보다. 같은 seed/생성기 판본/조건은 같은 바이트를 만들며, 다른 seed도 같은 기술 조건에서 시험할 수 있어야 한다.

등록된 공개 계약과 승인한 기술 조건 밖의 값/길이를 모델이 몰래 보존하지 못한다. 생성 결과의 실제 문자열/코드포인트 수/바이트 수를 앱이 계산하고 사용자 미리보기에 보여준다.

### 5.3 실행 요청과 환경

재현 요청은 `target_pair_id`, `target_pair_digest`, `synthetic_input_set_id`, `input_set_digest`, `oracle_id`를 참조한다. 앱이 현재 승인/도구 등록과 대조한다. 요청에 shell, argv, 임의 파일 경로를 받지 않는다.

실행 전에는 등록 target 자산, 미리 본 새 합성 입력, 결과의 공개 필드와 형식을 선택한다. 공개 자산 허용의 `kind`는 `fixed_asset`, `generated_input`, `tool_result_schema`로 나눈다. 앞의 두 종류는 실제 자산/input hash에 묶고, `tool_result_schema`는 `result_schema_digest`, 공개 field allowlist, target/input digest와 scope에 묶는다. 실행 전에 존재하지 않는 결과 bytes의 hash를 요구하지 않는다.

`reproduction_result`는 최종화 단계에서 충족할 need다. 실행 전 필수 후보가 아직 없다는 이유로 재현 시작을 차단하지 않는다. 실제 실행 뒤에는 허용한 결과 schema의 정형 필드만 공개 투영한다. 새로운 원자료 사실, 자유 stderr, 시스템 경로는 이 허용에 포함되지 않는다. 실제 결과와 공개 파일의 hash는 실행 뒤 검토와 최종 확인에 결합한다.

사전 준비된 바이너리를 네 번 실행한다. 두 입력 * buggy/fixed 조합이다. 전체 기본 상한은 15초, CPU 1개, 메모리 256 MiB, PID 64개, stdout/stderr 각각 64 KiB, tmpfs 32 MiB다. 실행 중 빌드/image pull/의존성 다운로드를 하지 않는다. sandbox 조건은 F10과 확장 계약을 따른다.

등록 target digest가 다르면 실행 전에 `error/TARGET_DIGEST_MISMATCH`다. 실행을 못 했는데 '재현되지 않음'으로 표시하지 않는다. timeout/컨테이너 오류/stdout 계약 오류는 모두 `error`다.

### 5.4 판정표

판정기는 고정 코드다. LLM의 설명은 판정 입력이 아니다.

| 상태 | 정확한 조건 | 사용자 안내 |
| --- | --- | --- |
| `not_requested` | 사용자가 아직 실행을 요청하지 않음 | 실행 또는 관찰 자료로 계속 |
| `not_run` | 요청했으나 실행 환경 없음 등 실제 미실행 | 이유를 표시, 성공 집계 금지 |
| `running` | 실제 실행 진행 중 | 취소/현재 단계 |
| `reproduced` | ASCII는 buggy/fixed 모두 성공/파일 일치; 한글은 buggy에서 지정 encode 오류/파일 없음, fixed에서 성공/파일 일치 | 정한 관찰 조건을 새 입력에서 확인 |
| `not_reproduced` | 실행과 대조군이 정상이고 buggy 후보에서 목표 증상이 나타나지 않음 | 입력/조건 검토 |
| `inconclusive` | 대조군 실패, 다른 단계 오류, fixed 예상 밖 실패, 불완전 관찰 | 환경/대상/관찰을 먼저 확인 |
| `error` | runner/sandbox/timeout/출력 계약 실패 | 환경 복구/재시도 |

판정 우선순위는 실행/계약 오류 -> 불완전/비목표 결과 -> 목표 재현 여부다. 예를 들어 9글자 입력의 validate 오류는 목표 encode 오류 재현이 아니다. 대조군 실패는 `inconclusive/CONTROL_FAILED`, 다른 단계의 오류는 `inconclusive/UNEXPECTED_TARGET_OUTCOME`다.

동일한 증상 확인은 동일한 근본 원인의 증명이 아니다. 결과 문장에는 대상 판본/입력 조건/관찰 범위를 남긴다. 원래 발생 조건을 확인하지 못한 경우 '원래 사건 재현 확인'이라고 쓰지 않는다.

### 5.5 실패와 공개 수준 재선택

재현 실패 시 원자료를 더 공개하는 자동 반복을 금지한다. 앱은 기존 승인 범위에서 다른 합성 입력을 시험하거나 사용자에게 필요한 기술 조건을 설명한다. 사용자는 조건 추가/수신 목적 축소/재현 없는 관찰 문의를 고를 수 있다. 재현 근거가 목표였다면 사용자가 명시적으로 `goal_variant=observations_only`로 바꾸어야 재현 없는 문의로 완료할 수 있다. 목표 변경은 revision을 올리고 재분석/새 결정을 거친다. 앱이 실패를 숨기려고 목표를 자동 변경하지 않는다.

새 선택은 revision을 올리고 이전 실행/초안을 stale로 만든다. 취소된 실행이 늦게 성공해도 현재 job/revision/input hash와 일치하지 않으면 채택하지 않는다. 공개 준비 완료 이후 실행 결과를 추가할 때도 새 revision과 검토가 필요하다.

`task_snapshots`는 revision 생성 당시 입력/선택/기준을 남기는 불변 기록이다. 실행을 시작할 때는 현재 결정/기준/팩을 다시 검증한 effective snapshot을 `jobs.snapshot_json`에 만든다. 분석 채택에서 같은 revision에 파생된 재사용 결정은 원래 task snapshot을 수정하지 않으며, 이후 재현 job은 그 현재 결정을 다시 검증해 입력에 결합한다.

## 6. 다른 조각과 닿는 곳

| 상대 | 입력/출력 | 서버 함수/API |
| --- | --- | --- |
| F03 | 승인 기술 조건과 공개 입력 미리보기 | 기존 decision/preview 계약 |
| F07 | 고정 target/runner/oracle 등록 | `ResolveReproductionRecipe` |
| 작업 실행 | kind=reproduce, expected_revision, typed args | `POST /api/v1/tasks/{id}/jobs`, `RunReproduction` |
| F04 | 공개 가능한 정형 실행 결과/불확실성 | `public_tool_results`, 의미 검토 |
| F05 | 불변 공개 asset/새 입력/실행 요약 | 파일 allowlist와 실제 bytes/hash |
| F09 | 진행/취소/실패/늦은 결과 | job/event 계약 |

`compose`가 현재 레시피의 승인된 실행을 포함할 수 있으며, 별도 재현 요청도 같은 서비스 함수를 사용한다. 작업당 current job 하나 규칙을 지킨다. 특정 버튼이 직접 Docker를 실행하는 경로를 만들지 않는다.

### 공개 패키지 계약

| 파일/디렉터리 | 내용 |
| --- | --- |
| `issue.md` | 환경/기대 동작/관찰/새 입력의 결과/미확인 사항/질문 |
| `README.md` | 의도적 toy 결함, 준비물, 실행법, 확인 범위 |
| `run-result.json` | 입력 특성, target 판본, 네 결과, 정형 판정 |
| `repro/go.mod` | 외부 모듈 의존성 없는 모듈 |
| `repro/cmd/buggy/`, `repro/cmd/fixed/` | 검토/등록된 고정 target 소스 |
| `repro/cmd/repro/` | 네 실행/파일 확인 runner |
| `repro/inputs/` | 새 입력 두 개 |
| `manifest.json` | 공개 payload 경로/크기/해시 |

공개 코드 asset은 등록 digest와 일치해야 한다. 내부 경로/실제 고객 입력/runner stderr/승인 DB 참조/평가 정답표를 포함하지 않는다. 수신자는 앱 DB 없이 아래 인터페이스로 실행한다.

```bash
cd repro
GOTOOLCHAIN=local GOPROXY=off go run ./cmd/repro --inputs ./inputs
```

호환 Go toolchain 준비는 수신자 환경 조건이다. runtime 다운로드가 필요하면 무인터넷 재현 성공으로 표시하지 않는다. 앱 내부 실행은 사전 빌드 바이너리를 사용해 빌드 시간이 실행 상한에 섞이지 않게 한다.

## 7. 하지 않을 것

범용 자동 버그 발견, 모든 라이브러리의 재현, 실제 코드 저장소 임의 실행, 모델이 oracle 수정, 실제 회사 파일 자동 첨부, 재현 없는 문의 차단, 다른 단계 오류를 성공으로 세기, 입력의 통계적 익명성 보장은 제외한다.

## 8. 끝났다는 기준

| ID | 조건과 기대 결과 |
| --- | --- |
| AC-F08-01 | 새 ASCII/한글 입력을 실제 실행해 표의 네 결과와 파일 바이트 확인 |
| AC-F08-02 | 원래 7글자 고객값 없이 새 6글자 입력으로 지정 조건을 확인 |
| AC-F08-03 | seed 변경 입력에서도 같은 기술 조건 검증, 고정 성공 문구로 대체 금지 |
| AC-F08-04 | parse/validate 오류를 encode 재현으로 세지 않음 |
| AC-F08-05 | 대조군/fixed 실패를 inconclusive, runner 오류를 error로 구분 |
| AC-F08-06 | 환경 없음은 not_run/no_environment. default/observations_only의 B2B 관찰 문의는 확정 가능하지만 reproduction_evidence는 차단 |
| AC-F08-07 | target/input digest 변경을 실행 전 차단, 판정기 runtime 수정 불가 |
| AC-F08-08 | 취소/공개 선택 변경 뒤 늦은 실행 결과가 현재 자료를 덮어쓰지 않음 |
| AC-F08-09 | 실행 결과 추가 후 실제 공개 파일과 새 해시에 대한 검토 수행 |
| AC-F08-10 | 독립 수신자가 공개 패키지만으로 실행해 동일 판정 확인 |
| AC-F08-11 | 실패 시 사용자가 UI-04로 돌아가 조건을 고를 수 있고 자동 추가 공개 없음. 목표 축소는 명시 선택/revision 증가/재분석/새 결정 필요 |
| AC-F08-12 | 공개 패키지에 내부 원자료/평가 정답/수신자 전용 trace/원시 stderr 없음 |

QA 연결: AC-F08-01-03 -> T54, 04 -> T13, 05 -> T14, 06 -> T15/T55, 07 -> T27, 08 -> T03/T51, 09 -> T20, 10 -> T59, 11 -> T39/T58, 12 -> T16/T56. [QA](../qa/qa.md)의 관찰 문의 허용과 재현 목적 완료 조건을 함께 검사한다.

## 9. 확인 필요

Q-EXT: 다음 실제 라이브러리/버전과 실행/관찰 계약. Q-DEPLOY: 실제 sandbox 사용 가능 환경. Q-LICENSE: 실제 target 코드의 공개 패키지 포함 조건. toy 예시는 고정 설계로 개발하며 실제 제품 범용성은 별도 검증한다.

## 10. 구현 순서와 변경 영향

앱 없이 toy target 네 결과 확인 -> 고정 oracle -> 생성기 -> sandbox runner -> typed tool adapter -> 공개 패키지 -> UI 및 실패 복귀 -> 독립 수신자 실행 순서다. oracle/target/입력 계약 변경은 새 판본과 새 검증 결과를 요구한다. 기존 재현 성공 기록을 새 판본에 복사하지 않는다.
