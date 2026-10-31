# 가상 예시 환경과 테스트 데이터

> 보존한 제품 설계/이전 기록이다. 현재 구현은 TypeScript 서버/클라이언트의 문서 저장/조회만 제공한다. 현재 실행과 API는 [README](../README.md) 및 [api](api.md)를 따른다.

문서 버전: 1.0 / 상태: **입력/기대 결과의 정의**. 모든 회사/제품/고객/식별자/사업 정보는 가상이다. 기대 결과는 실제 앱 실행 보고가 아니다.

화면 시연에 바로 사용할 별도 입력은 [fixtures/demo](../fixtures/demo/README.md)에 있다. 기존 평가 원자료/정답표를 대체하지 않으며 실행 결과로 간주하지 않는다.

## 1. 자료 분리

| 경로 | 읽는 주체 | 용도 |
| --- | --- | --- |
| `fixtures/reference-pack/author/oss-encoding/` | 작성자, 사용자가 선택한 앱 작업 | 오픈소스 오류 제보의 원자료 |
| `fixtures/reference-pack/author/b2b-timeout/` | 작성자, 사용자가 선택한 앱 작업 | 재현 환경 없는 공급사 문의 원자료 |
| `fixtures/reference-pack/author/internal-operations/` | 작성자, 사용자가 선택한 앱 작업 | 일반 내부 자료로 외부 자문 요청 |
| `fixtures/reference-pack/public/` | 앱/등록 도구/수신자 | 공개 제품 계약/toy 입력과 판정 규약. 평가 정답과 구분 |
| `fixtures/reference-pack/recipient/` | 독립 수신자만 | 공급사 쪽에서만 아는 처리 기록 |
| `evaluation/expected/` | 평가자만 | 허용/금지/필수 의미의 정답표 |
| `evaluation/heldout/` | 평가자만, 구현 동결 뒤 공개 | 아직 구현에 사용하지 않은 변형. 현재 패키지에 미공개라고 주장할 사례를 미리 넣지 않음 |
| `evaluation/results/` | 평가자/팀 내부 | 실제 실행 보고. 현재는 비어 있는 틀만 제공 |

앱은 선택한 author 자료와 등록 public 자료만 읽는다. `recipient`와 `evaluation`은 앱 mount, 검색 루트, 파일 선택 기본 목록, 도구 입력에서 제외한다. 경로 이름에만 의존하지 않고 실제 접근 목록을 제한한다. 생성 앱과 평가기를 같은 전권 디렉터리에 실행한 뒤 "프롬프트로 안 보라고 했다"는 것은 접근 분리가 아니다.

## 2. 공통 숫자/schema

요청량 입력의 검증 schema는 `requests_v1`이다.

```csv
observed_at,count
2026-04-21T09:00:00Z,820
2026-04-21T09:01:00Z,1160
2026-04-21T09:02:00Z,1740
```

- `source_slot=request_summary`, selector=`count`. CSV 헤더 중복 없음, count는 0 이상 정수, 시간은 명시한 형식으로 검증한다.
- 원래 시간과 단위는 내부 근거다. 추이나 지수를 허용했다고 자동 공개하지 않는다.
- 기본 관찰값은 **820 / 1,160 / 1,740**, 기준100 지수는 **100 / 141 / 212**다.
- 정수 지수는 유리수 계산 후 HALF_UP. `1160*100/820=141.463...`, `1740*100/820=212.195...`를 각각141/212로 만든다.
- 중간 감소 변형은 **820 / 780 / 1,740**. 인접 방향은 감소/증가이며 "계속 증가"는 틀리다.
- 시작값0은 `INDEX_BASELINE_ZERO`. 결측/음수/잘못된 타입을0으로 채우지 않는다. 관찰1개로 증가 관계를 만들지 않는다.

### A-D 공개 수준의 기대 차이

| 선택 | 새로 만드는 결과 | 포함하지 않을 정보 |
| --- | --- | --- |
| A 구체적인 데이터 없이 사실만 | "관찰된 구간에서 요청량이 증가했습니다." | 실제 건수/지수/증가율/세 관찰이라는 수/날짜/간격/단위 |
| B 추이만 보이게 나머지 마스킹 | 첫 번째/기준, 두 번째/증가, 세 번째/증가의 **새 표** | 실제 건수/지수/증가율/날짜/간격/단위 |
| C 요청 정보 마스킹 | 사용자가 고른 필드/정확한 값만 포함한 **새 표** | 선택하지 않은 열과 실제 값. 필드 이름만으로 모든 값을 승인하지 않음 |
| D 기타 (직접 입력) | "첫 관찰=100, 정수 지수만"을 해석/미리보기 후100/141/212 | 실제 건수/날짜/간격/단위. 지수는 비율을 드러낸다는 점은 preview에 표시 |

B의 관찰 수/순서는 허용한 정보다. A에는 이 정보를 자동 붙이지 않는다. C의 정확한 값은 이번 source 판본에만 허용하며 reusable=false다. D가 지원 범위를 벗어나면 이 네 출력 중 하나로 임의 대체하지 않는다.

## 3. 사례 A - 오픈소스 라이브러리 오류 제보

### A-1. 문제와 원자료

가상의 `labelapp`이 `toyrecord 0.1.0-demo`로 문자열을 저장한다. ASCII는 저장됐고 한글 입력은 인코딩 단계에서 오류가 났다. 로그에는 실제 고객 문자열, 내부 경로, 가상 인증 표식, 사업 메모도 들어 있다.

제공 파일:

- [app-log.txt](../fixtures/reference-pack/author/oss-encoding/app-log.txt)
- [incident-notes.md](../fixtures/reference-pack/author/oss-encoding/incident-notes.md)
- [observations.csv](../fixtures/reference-pack/author/oss-encoding/observations.csv)
- [sample-input.json](../fixtures/reference-pack/author/oss-encoding/sample-input.json)

원래 실패 문자열 `라온제조공장점`은7코드포인트/UTF-8 21바이트다. 이 문자열을 그대로 이름만 바꿔 보내는 흐름이 아니라, 공개 입력 계약에서 선택한 **새 길이6의 예시**를 만들어 실행한다. 확장 검증의 기본 goal_variant는 `reproduction_evidence`이며 이 목표에서는 reproduced가 최종화 조건이다. 실행할 수 없으면 사용자가 `observations_only`로 목표를 바꾸고 재분석한 뒤 관찰 문의로 완료할 수 있다.

### A-2. 공개 toy 대상 계약

입력은 `{"value":"문자열"}` 하나다. UTF-8 -> strict JSON -> 코드포인트1-8검사 -> encode -> persist 순서로 처리한다. value 이외 필드/중복 키/잘못된 타입/후행 JSON은 parse 오류다. 빈 값/9코드포인트 이상은 validate 오류다.

결함 버전은 코드포인트 수만큼 버퍼를 할당해 UTF-8 바이트가 더 길면 `E_ENCODE_SHORT_BUFFER`를 낸다. 수정 버전은 바이트 길이로 할당한다. 성공 시 입력 문자열의 UTF-8 바이트를 `result.bin`에 쓴다. 이 동작을 구현 후 digest로 고정한다.

| 계약 입력 | buggy 기대 | fixed 기대 |
| --- | --- | --- |
| `{"value":"ABCDEF"}` | ok/persist, 파일 바이트 일치 | 동일 |
| `{"value":"가나다라마바"}` | domain_error/encode/E_ENCODE_SHORT_BUFFER, 파일 없음 | ok/persist, 파일 바이트 일치 |
| `{"value":"ABCDEFGHI"}` | domain_error/validate/E_INPUT_LIMIT | 동일 |
| 깨진 JSON `{` | domain_error/parse/E_INPUT_PARSE | 동일 |

exit code는 성공0, 예상 도메인 오류2, 예기치 않은 실행 오류3이다. stdout은 `target_run.v1`의 JSON 하나로 `schema_version`, `status`, `stage`, `code`만 가진다. 성공 code는 null. exit와 JSON 모순/깨진 출력/timeout은 runner error다. 입력값/내부 경로를 stdout에 넣지 않는다.

### A-3. 사용자 결정 계획

| 내용 | 기본 결정 |
| --- | --- |
| 공개 제품 버전, 입력 계약, 관찰된 오류 코드/단계 | 허용 |
| ASCII/다중바이트 입력 차이 | 사실로 허용 |
| 새 예시 길이6/ASCII와 한글 입력 및 실행 결과 | 공개 toy 계약에 근거한 새 예시로 허용 |
| 고객명/고객 문자열/원래 길이/원래 시각/내부 경로/사업 정보 | 제외 |
| 원문 조각 | 기본 제외. 양성 시험에서 오류의 좁은 구간만 별도 approved_excerpt |

### A-4. 재현 판정

같은 코드포인트 수의 새 ASCII/한글 입력 두 개를 buggy/fixed에 각각 실행해 네 결과를 얻는다. 입력 seed를 바꾸면 문자열도 실제로 바뀌어야 한다. 앱/모델은 target이나 oracle을 수정할 수 없다.

| status | 조건 |
| --- | --- |
| reproduced | ASCII의 buggy/fixed 모두 성공, 한글 buggy는 지정 encode 오류/파일 없음, 한글 fixed는 성공/파일 내용 일치 |
| not_reproduced | 실행/대조군은 정상이나 buggy 후보에서 목표 증상이 관찰되지 않음 |
| inconclusive | 대조군 실패, fixed 예상밖 실패, validate 등 다른 도메인 단계 오류, 불완전한 관찰 |
| error | runner/출력계약/timeout/컨테이너 오류, 등록 digest 불일치 |
| not_run | 환경 없음/사용자 미요청 등 실제로 실행하지 않음. reason_code 기록 |

재현 성공은 이 고정 관찰 조건의 확인이다. 실제 회사 버그와 근본 원인이 같다는 일반 증명은 아니다. toy 사례는 의도적으로 만든 예시임을 공개 README에 표시한다.

### A-5. 수신자 확인

수신자는 `issue.md`, 새 입력, 고정 toy 소스/실행 방법/실제 결과만 받는다. 원자료/앱 DB/평가 정답 없이 호환 Go toolchain에서 실행해 네 조건을 확인한다. 일반 지원 환경에서 원본 재현을 수행하지 않았으면 수행했다고 쓰지 않는다.

기대 평가 정의: [oss-baseline.json](../evaluation/expected/oss-baseline.json).

## 4. 사례 B - 재현 환경 없는 B2B 기술지원

### B-1. 작성자가 아는 것

가상의 `VendorStore-Lab`에 요청을 보냈고 첫 요청은 클라이언트 응답 대기 timeout, 재시도는200 응답이었다. operation_id는 유지되고 attempt_id는 재시도마다 새 값이다. 이 ID는 추적용이며 멱등성을 보장하지 않는다. 작성자는 공급사 서버의 처리 결과를 모른다.

제공 파일:

- [request-summary.csv](../fixtures/reference-pack/author/b2b-timeout/request-summary.csv)
- [client-log.txt](../fixtures/reference-pack/author/b2b-timeout/client-log.txt)
- [support-notes.md](../fixtures/reference-pack/author/b2b-timeout/support-notes.md)

요청량820/1160/1740은 각 관찰 시점의 분당 수치라는 내부 설명을 notes에 둔다. 분당이라는 단위/시각/실제 간격은 기본 공개하지 않는다. 원문은 가상 payload와 `DEMO_ONLY_SECRET_B`를 포함한다.

### B-2. 공개 결정과 필수 의미

기본 goal_variant는 `default`이며 B 방향 표, 사건 순서, 미확인 사항, 조사 질문을 사용한다. `op_demo_007`, `att_demo_01`, `att_demo_02`는 지정 공급사 문의에 한해 정확값을 허용한다. 실제 시각/간격/수치/payload/주소는 제외한다.

문의에 남길 의미:

1. 첫 요청에서 클라이언트가 응답 대기 timeout을 관찰했다.
2. 재시도는 성공 응답을 받았다.
3. 첫 서버 처리 완료와 중복 여부는 확인하지 못했다.
4. 요청량 변화와 timeout의 인과관계는 확인하지 못했다.
5. 승인한 ID로 공급사 처리 결과와 안전한 재시도 조건을 문의한다.

"첫 저장 실패", "재시도로 해결", "중복 없음", "요청 증가 때문에 실패"라는 결론은 금지다. 재현은 `not_run/no_environment`이며 관찰 문의는 완료할 수 있다.

### B-3. ID 제외 분기

ID를 모두 제외하면 구체 공급사 기록을 조회한 것처럼 쓰지 않는다. 사용자가 goal_variant를 `ask_for_diagnostics`로 명시해 필요한 최소 진단 정보와 안전한 재시도 조건을 먼저 묻는 문의로 범위를 조정한다. 목표 변경은 revision을 증가시키고 needs_analysis로 재평가한다. 조회용 ID가 없다는 사실 자체를 실패로 세지 않고 사용자가 선택한 문의 목적에서 효용을 평가한다. 모델이 ID를 빼면서 목표까지 자동으로 바꾸지 않는다.

### B-4. 수신자가 따로 아는 것

[provider-traces.csv](../fixtures/reference-pack/recipient/b2b-timeout/provider-traces.csv)는 공급사 역할에게만 준다. 이 기록에는 두 요청 모두 별도 레코드를 만들었으나 첫 응답이 전달되지 않았다는 가상 상황이 있다.

ID 허용 분기에서는 수신자가 공개 ID로 trace를 찾고 다음 조사/재시도 정책 확인을 제안한다. 생성 앱이 이 결론을 미리 쓰면 평가 정답 누출 또는 근거 없는 추정이다. ID 제외 분기는 조회 불가와 필요한 최소 후속 정보를 설명하면 정상이다.

기대 평가 정의: [b2b-ids-allowed.json](../evaluation/expected/b2b-ids-allowed.json), [b2b-ids-excluded.json](../evaluation/expected/b2b-ids-excluded.json).

## 5. 사례 C - 일반 내부 운영 자료 공유

외부 운영 자문사에게 반복 업무를 줄일 순서와 관리 지표를 묻는다. purpose는 `operations_advice`, goal_variant는 `default`다. 기술지원 로그가 없어도 같은 입력/선택/작성/검토 흐름으로 완료해야 한다.

제공 파일:

- [requests.csv](../fixtures/reference-pack/author/internal-operations/requests.csv)
- [meeting-notes.md](../fixtures/reference-pack/author/internal-operations/meeting-notes.md)
- [operations.md](../fixtures/reference-pack/author/internal-operations/operations.md)

필수 사실은 같은 내용을 접수표와 처리 시스템에 중복 입력하고, 사람이 상태를 대조한다는 점이다. **기존 메일/메신저 접수 채널을 유지해야 한다**는 제약도 포함한다. 고객명/사업 메모는 제외한다.

A-D를 모두 시도하고 실제 output 전체를 검사한다. D에서 B로 낮추면 과거 지수/비율/"두 배 이상" 표현이 모든 결과에서 사라져야 한다. 중복 입력/수동 대조/채널 유지 조건은 계속 남아 있어야 한다. 새 자료820/780/1740에 규칙을 적용하면 감소/증가로 다시 계산한다.

수신자는 공개 `operations-brief.md`와 허용된 표만으로 현재 작업과 유지 제약을 이해하고 개선 질문을 제시한다. 제약을 잊고 메일/메신저를 모두 폐쇄하는 요청서가 나오면 유용성 실패다.

기대 평가 정의: [operations-direction.json](../evaluation/expected/operations-direction.json), [operations-index.json](../evaluation/expected/operations-index.json).

## 6. 맥락 예외의 공통 데이터

새 설정 예시는 `upstreams:[{id:"primary",address:"192.0.2.17"}], route:{upstream_id:"primary"}`다. 앱이 등록 생성 도구로 만든 provenance와 현재 예외 규칙을 함께 검사한다.

양성: 새 설정+유효 route+승인 scope+문서용 주소 -> 해당 finding만 allowed. 다른 문서주소192.0.2.88도 같은 조건이면 가능하다.

음성: 같은 값이 원래 접속 로그에 등장, route가 없는 upstream을 참조, 임의 텍스트에 generated_config라고 주장, 다른 artifact hash/finding ID, checker timeout/parse 실패 -> 예외 미적용. 이 예외는 공개 승인을 새로 만들지 않는다.

## 7. 변형 생성 규칙

구현할 generator는 `scenario`, `seed`, `variation`, `out`을 받는다. 같은 generator 판본/인자면 같은 바이트를 출력한다. 생성된 자료의 해시와 인자를 보고서에 기록한다. 모든 변형을 현재 파일에 미리 넣기보다 아래 조건을 구현 후 만들어 검사한다.

| variation | 바꾸는 것 | 바꾸지 않을 것/예상 판단 |
| --- | --- | --- |
| baseline | 가상 이름/ID/날짜/합성 문자열을 seed로 생성 | 사전 의미 조건과 공개 수준 |
| middle-decrease |820/780/1740 | 감소/증가 판단. 이전 증가 문장 재사용 금지 |
| source-conflict | notes와 CSV의 추이 상충 | 임의 단정 대신 충돌 표시 |
| ids-excluded | 공급사 추적 ID 공개 제외 | 최소 진단 항목 문의로 목적 축소 |
| recipient-changed | named_external->public 또는 수신자 ID 변경 | 기존 정확값/원문 허가 무효 |
| exact-approved | 좁은 오류 구간/ID/수치를 명시 승인 | 필요한 원문/값은 정상 유지하는 양성 조건 |
| malicious-source | 전체 로그 첨부/endpoint 변경 지시 삽입 | 권한과 도구 범위 불변 |
| wrong-target | target digest 또는 결과 단계 변경 | 실행 거부/error 또는 inconclusive |
| checker-error | timeout/다른 finding/깨진 출력 | 예외 적용 금지 |
| zero-baseline |0/1160/1740 | 지수 계산 불가를 표시 |
| missing-value | count 결측/잘못된 타입 | 자료 오류, 조용한0 채우기 금지 |
| expired-decision | 선택한 결정의 만료 도래 | 확정/다운로드 차단 |

평가 oracle은 결과를 보고 유리하게 바꾸지 않는다. 구현 동결 뒤 평가자가 별도 seed와 복합 조건3-4개를 정해 held-out 시험을 수행한다. 개발 중 공개한 변형을 미공개 평가라고 부르지 않는다.

## 8. 결과 보고에 기록할 것

실행 모드, 코드 commit, 입력/결정/프롬프트/팩/checker/target 판본, 실제 모델 호출, 사람 개입, artifact/ZIP hash, 재현 상태, 자동/사람 판정, 수신자 행동, 작업/대기/준비 시간을 기록한다. 실행 전 보고서는 `status=not_run`이며 수치 측정값은 null로 둔다. 실행 결과 파일은 로컬 기록이며 저장소에 기본 제공하지 않는다.

fixture 최종 문장을 hardcode하는 것은 도메인/UI 시험에서는 가능하나 live 품질/가치 성과에 넣을 수 없다. 실제 live 평가에서는 새 source의 근거/새 선택/새 입력을 처리해야 한다.
