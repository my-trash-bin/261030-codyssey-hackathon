# 제품별 지침, 보조 도구와 재현 확장

버전: 2.0 / 기준일: 2026-10-31 / 상태: 현행 구현 계약 (`@safehandoff/skill-loader`, `@safehandoff/core`, `@safehandoff/sandbox-runner` 기준)

이 문서는 PRD-10/11의 구현 경계다. 라이브러리나 제품별로 먼저 확인할 질문, 공유 양식, 변환, 검사를 추가할 수 있게 한다. 기능 담당자는 [F07](features/07-domain-extensions.md)과 [F08](features/08-reproduction.md)를 함께 읽는다. 제품별 전문성을 매번 긴 프롬프트에 다시 입력하지 않고 등록된 지침과 검사로 재사용하는 것이 목적이다.

## 1. 확장 종류와 이번 구현

| 종류 | 맡는 일 | 이번 PoC |
| --- | --- | --- |
| 업무 지침 팩 | 필요한 정보/미확인 사항/질문 순서/공개 양식 정의 | `vendorstore-support`, `toyrecord-repro` 두 팩 (`FsSkillPackLoader` 및 `pack-register.mjs`) |
| 결정적 변환 | 승인한 사실로 추이/시간/예시 설정을 계산 | builtin TypeScript 함수 5종 (`packages/core/src/builtin-tools.ts`) |
| 맥락 검사기 | 제품 구조/생성 경위/현재 승인과 finding의 일치 검사 | 내장 IP checker와 동일 계약의 process 실행기 |
| 재현 레시피 | 고정 대상/입력 계약/실행법/관찰 판정 지정 | 의도적 결함이 있는 `toyrecord` (`DockerReproRunner` 4회 실행) |

이번 범위에서 사용자가 올린 임의 스크립트를 바로 실행하지 않는다. 팀이 새 검사기를 코드 검토한 뒤 설치 설정에 등록할 수 있다. 사용자는 설치된 팩을 선택한다. 외부 마켓/자동 다운로드/실행 중 코드 생성은 후속이다.

## 2. 지침의 파일 구조

Agent Skills의 `SKILL.md`, `references/`, `scripts/`, `assets/` 디렉터리 관례를 사용할 수 있다.[S-EXT-01] SafeHandoff의 승인/권한/digest/도구 registry는 아래 별도 계약이다. 표준 폴더를 썼다는 이유로 도구 실행이나 공개 권한이 생기지 않는다.

```text
packs/vendorstore-support/
  SKILL.md
  manifest.json
  references/analysis.md
  references/public-writing.md
  references/reviewer-checks.md
  assets/support-request-template.json
```

`SKILL.md`는 제품 개요와 지침 진입점이다. 내부 제품 문서/고객명/조사 과정이 들어갈 수 있으므로 작성기에 통째로 넘기지 않는다. `public-writing.md`와 공개 asset은 설치 담당자가 외부 결과 작성에 사용할 수 있는 내용으로 검토한 별도 파일이다.

```json
{
  "schema_version": "skill_manifest.v1",
  "id": "vendorstore-support",
  "version": "1.0.0",
  "product_ids": ["vendorstore-lab"],
  "purpose_ids": ["vendor_support"],
  "role_documents": {
    "analyst": ["SKILL.md", "references/analysis.md"],
    "writer": ["references/public-writing.md"],
    "reviewer": ["references/reviewer-checks.md"]
  },
  "tool_ids": [
    "derive_series_v1", "render_timeline_v1",
    "make_config_example_v1", "check_doc_ip_context_v1"
  ],
  "template_ids": ["vendor_support.v1"]
}
```

설명용 manifest다. `product_ids`와 `purpose_ids`는 앱에 등록된 값만 참조한다. 각 경로는 팩 루트 아래 상대경로만 허용하고 상위경로/절대경로/심볼릭 링크/중복 이름을 거부한다. 설치 시 manifest와 참조 파일의 digest를 고정한다. `version` 문자열만 같고 바이트가 달라진 팩은 원래 판본으로 인정하지 않는다.

## 3. 설치와 활성화

설치 담당자는 코드와 공개 작성 지침을 검토하고 로컬 catalog에 등록한다. 최초 PoC에서는 설정 파일과 배포 파일로 등록하며 별도 설치 웹 화면을 만들지 않는다. 모델은 팩 후보를 추천할 수 있지만 설치/활성화/권한 확대를 수행하지 못한다.

UI-09에는 설치 팩의 이름/버전/지문/호환 목적/검사 환경 상태를 표시한다. UI-02/03에서 사용자가 해당 작업의 팩을 선택한다. 제품이 맞지 않으면 사용 불가 이유를 보여준다. 공개 양식이 없는 팩은 분석 보조로만 사용할 수 있으며 writer에 내부 문서를 대신 넣지 않는다.

작업은 활성 팩 목록과 모든 관련 파일의 `skill_set_hash`를 스냅샷에 저장한다. 진행 중 팩이 교체되면 이전 job 결과를 채택하지 않는다. 새 팩 적용은 작업 revision을 올리고 공개 기준 재사용/작성/검토를 다시 평가한다. 기존 완료 자료가 새 지침을 이미 통과했다고 표시하지 않는다.

## 4. 역할과 도구 권한

실행 가능 도구는 **앱 registry 교집합 역할 허용 목록 교집합 선택 팩 교집합 현재 결정**의 교집합이다. 팩의 `tool_ids`는 요구 목록이지 허가 자체가 아니다. writer는 승인된 결과를 읽고 필요한 슬롯을 제안할 수 있지만 도구 실행 명령을 직접 수행하지 않는다. 오케스트레이터가 typed request를 구성한다.

| 도구 | 입력 | 공개 결과 | 별도 조건 |
| --- | --- | --- | --- |
| `derive_series_v1` | 검증된 series ref, 승인 transform | 사실/방향/지수/선택값 | 값/비율/순서 각각 승인 범위 확인 |
| `render_timeline_v1` | 승인 사건, 시간 표현 종류 | 새 사건 순서/허용 간격 | 시각 이동도 실제 간격을 드러낼 수 있음 |
| `render_approved_excerpt_v1` | 원문 grant, source 판본 | 렌더된 원문 슬롯 | 정확한 byte range와 렌더 hash 일치 |
| `make_config_example_v1` | 공개 스키마, 승인 예시 조건 | 새 JSON 설정 | 원자료 설정을 복사하지 않음 |
| `check_doc_ip_context_v1` | finding, 현재 해시/승인, provenance | finding 하나의 판정 | 다른 finding 해제/새 공개권한 금지 |
| `make_synthetic_inputs_v1` | 공개 target 계약, 승인 기술 특성, seed | 새 입력 두 개 | 원래 고객 값/길이 자동 보존 금지 |
| `run_repro_v1` | 고정 target pair, 새 입력, oracle | 정형 실행/판정 | 실제 실행 환경/고정 digest 필요 |
| `scan_candidate_bundle_v1` | 실제 파일 bytes/manifest | 위치 있는 findings | 의미 검토를 대체하지 않음 |

도구 입력에는 `tool_id`, `tool_version`, `task_id`, `revision`, `grant_ids`, `arguments`를 쓴다. `grant_ids`는 앱이 조회/검증할 현재 decision/승인 슬롯 참조다. 문자열이 존재하는 것만으로 허용하지 않는다. 결과는 `status`, `public_result`, `internal_diagnostics`를 분리한다. `public_result`도 현재 공개 결정과 연결된 필드만 writer에 전달한다.

모든 input/output은 버전 계약으로 검증한다. 알 수 없는 필드/중복 JSON 키/다른 task ID/다른 revision/잘못된 enum은 오류다. 도구가 돌려준 shell, URL, SQL, 임의 경로를 후속 실행 요청으로 해석하지 않는다.

공개 확장 허용은 `public_asset_grant.kind`에 따라 구분한다. `fixed_asset`은 등록 파일 digest와 공개 범위를, `generated_input`은 사용자가 본 새 입력의 실제 hash와 생성 조건을 묶는다. `tool_result_schema`는 실행 전에 알 수 있는 결과 schema digest, 공개 field allowlist, 고정 target/input digest, scope를 묶는다. 이 마지막 허용은 임의 stdout이나 새 원자료 사실의 공개 허용이 아니다. 실행 후 그 스키마/필드에 맞는 정형 결과만 투영하고 실제 result/file hash에 대해 검토/최종 확인한다.

## 5. 내장 도구와 process 도구

`ToolRunner`는 builtin과 process 어댑터를 둔다. builtin은 TypeScript 순수 함수(`packages/core/src/builtin-tools.ts`) 호출이며 등록한 인수만 받는다. process는 사전 등록 실행 파일을 JSON stdin/JSON stdout으로 호출한다. IP checker는 같은 판정 함수를 CLI로 감싸 builtin과 process의 정상/오류 결과가 같은지 확인한다.

process 등록에는 실행 파일/이미지 digest, 고정 argv, input/output schema, 마운트 허용 파일, 시간/출력/자원 상한을 포함한다. 요청에서 argv나 mount 경로를 받지 않는다. 컨테이너 stdout은 계약 JSON 하나이며 stderr는 내부 진단 전용이다. 종료코드/JSON status가 모순되거나 뒤에 JSON이 더 붙으면 `TOOL_CONTRACT_ERROR`다.

기본 제한은 CPU 1개, 메모리 256 MiB, PID 64개, 출력 stdout/stderr 각각 64 KiB, 쓰기 공간 32 MiB, 전체 실행 15초다. 이는 조정 가능한 PoC 기본값이며 실행 속도 보장이 아니다. process는 네트워크 없음/읽기 전용 root/non-root/capability 제거/새 권한 획득 금지를 적용한다. Docker `none` 네트워크의 동작은 공식 문서를 참고한다.[S-EXT-02]

원자료 DB/모델 인증키/Docker socket을 자식에게 넘기지 않는다. 인터넷에서 이미지나 의존성을 받는 일은 준비 단계에서 끝낸다. Docker가 없으면 `not_run/no_environment`로 기록하며, 호스트 shell로 대체하지 않는다. 필수 검사기 미수행은 확정을 차단한다.

## 6. 요청량 변환의 정확한 의미

| 선택 | transform | 공개되는 정보 |
| --- | --- | --- |
| A 사실만 | `series_fact_summary.v1` | 승인한 증가 사실. 관찰 개수/간격/규모 제외 |
| B 추이만 | `series_direction_only.v1` | 관찰 순서와 개수, 인접 방향. 건수/지수/날짜/간격 제외 |
| C 필드 선택 | `select_fields.v1` | 사용자가 미리 본 선택 필드와 실제값 |
| D 상대지수 예시 | `series_index_base100.v1` | 첫 값 대비 비율. 원래 건수는 제외 |

`requests_v1`은 `source_slot=request_summary`, `observed_at`, `count` 열을 검증한 자료다. `count`는 0 이상의 정수이며 결측/음수/숫자가 아닌 값은 거부한다. 실제 관찰 시각은 공개 결정 없이 결과에 넣지 않는다.

820/1160/1740의 정수 지수는 100/141/212다. 계산은 정확한 분수 기반, 반올림은 `HALF_UP`으로 고정한다. 첫 값 0은 `INDEX_BASELINE_ZERO`이며 임의로 1을 넣지 않는다. 820/780/1740이면 인접 방향은 감소/증가다. 최종값이 처음보다 크다는 사실과 '계속 증가'는 구분한다.

변환이 성공해도 공개 결정이 생기지 않는다. 미리보기 단계는 계산만 수행하고 사용자의 적용 동작이 현재 결정을 저장한다.

## 7. 로그 시간의 표현

| 표현 | 뜻 | 허용 조건 |
| --- | --- | --- |
| `sequence_only` | 사건 1 -> 사건 2 | 사건 순서 공개 |
| `relative_intervals` | T+0초 -> T+5초 | 실제 간격 공개 |
| `shifted_absolute` | 새 시작 시각에 실제 간격을 더함 | 실제 간격 공개도 필요 |
| `synthetic_schedule` | 원래 간격과 무관한 예시 시각 | 합성임을 표시, 실제 관찰로 서술 금지 |

기본은 승인된 사건으로 새 타임라인을 작성한다. 원문 로그에 단순 offset을 더하는 범용 덮어쓰기 명령은 제공하지 않는다. 원문 일부를 그대로 쓰는 확장은 별도 원문 grant를 요구하고 변환 후 실제 공개 바이트를 다시 확인한다.

원문 인용의 `hidden_ranges`는 원자료 전체에 대한 절대 UTF-8 바이트 좌표다. 각 반열린 구간은 정수이고 승인한 excerpt 안에 완전히 포함되며, 정렬/비중첩/UTF-8 문자 경계 조건을 만족해야 한다. 각 구간을 고정 문자열 `[가림]`의 UTF-8 바이트로 치환한다. 잘못된 구간을 자르거나 합쳐 추정하지 않고 거부한다. 사용자는 이 규칙으로 렌더링한 실제 인용을 확인하며 결과 hash를 grant에 묶는다.

## 8. 맥락에 따른 IP 예외 계약

아래는 새 설명용 설정의 예다.

```json
{
  "upstreams": [{"id": "primary", "address": "192.0.2.17"}],
  "route": {"upstream_id": "primary"}
}
```

RFC 5737의 문서 예시용 대역인 `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`만 이 레시피에서 사용한다.[S-EXT-03] 주소 대역 일치만으로 허용하지 않는다. checker는 다음 조건을 모두 확인한다.

1. 요청 finding과 현재 `artifact_set_hash`가 일치한다.
2. 해당 슬롯은 현재 작업/목적/수신자에서 공개 승인됐다.
3. 앱 provenance가 `make_config_example_v1`의 새 생성 결과다.
4. 제품 config schema의 address 필드이며 route 참조가 유효하다.
5. 등록 checker/팩의 digest와 현재 승인 범위가 유효하다.
6. 주소가 지정된 문서용 대역 안에 있다.

```json
{
  "schema_version": "context_check.v1",
  "finding_id": "finding_ip_example",
  "artifact_set_hash": "example-current-set-hash",
  "status": "allowed",
  "reason_code": "APPROVED_DOCUMENTATION_ADDRESS_IN_GENERATED_CONFIG"
}
```

`status`는 `allowed`, `denied`, `unknown`, `error`다. allowed는 요청 finding만 해소한다. 필드/위치/해시가 다르면 결과를 채택하지 않는다. 예외 사유는 `findings`와 `tool_runs`에 남기고 공개 본문에 검사기의 내부 설명을 복사하지 않는다.

보안 findings의 `severity`는 UI 표시 우선순위다. info/warning이라는 이유로 자동 무시하지 않으며 모든 보안 finding을 해소해야 확정할 수 있다. 비보안 안내는 finding으로 만들지 않고 event로 분리한다. 사람이 의미 검토를 완료했다는 기록도 미해결 보안 finding을 해소하지 않는다.

| 상황 | 결과 |
| --- | --- |
| 같은 조건의 새 설정에서 `192.0.2.88` 사용 | 조건 충족 시 allowed |
| 원래 접속 로그에 같은 `192.0.2.17` 존재 | generated_config 예외 적용 불가 |
| 사용자가 본문에 `generated_config`라고 적음 | 앱 provenance 불변, 예외 적용 불가 |
| 설정의 route가 없는 upstream을 참조 | denied, 설정 수정 필요 |
| 구조를 파싱할 수 없음 | unknown, 자동 해제 금지 |
| timeout/프로세스 실패/잘못된 응답 | error, 자동 해제 금지 |
| 다른 finding ID로 허용 응답 | `TOOL_CONTRACT_ERROR`, 원 finding 미해결 |

## 9. 합성 재현의 입력과 판정

`toyrecord-repro` 팩은 공개 제품 계약, 작은 새 입력을 만드는 도구, 고정 buggy/fixed 대상, 고정 oracle을 묶는다. 사용자의 원래 비밀 값을 수정한 결과를 무조건 '합성'이라고 부르지 않는다. 이 PoC는 승인된 기술 특성과 공개 입력 계약에서 새 ASCII/한글 입력을 만든다.

재현 결과는 `not_requested`, `not_run`, `running`, `reproduced`, `not_reproduced`, `inconclusive`, `error`다. 환경 없음은 `not_run`의 `reason_code=no_environment`다. `reproduced`는 정한 관찰 조건을 만족했다는 의미이고 원래 사건과 같은 근본 원인임을 증명하지 않는다.

`reproduction_result`는 실행 후 확인하는 최종화 단계의 필요 정보다. 실행 전 공개 선택 게이트에서 아직 없는 결과를 요구하지 않는다. 실행 전에 target/새 입력/공개 결과 schema/필드를 허용하고, 실행 후 해당 정형 결과를 투영해 실제 파일을 검토한다. `goal_variant=reproduction_evidence`는 현재 고정 조건에서 `reproduced`여야 목표 완료이며, 다른 목표의 관찰 문의는 미실행 상태를 정확히 밝히고 진행할 수 있다.

결과가 부족하면 환경/target/입력/관찰을 확인한 뒤 사용자에게 추가 선택 또는 문의 범위 조정을 제안한다. 같은 실패를 반복하면서 자동으로 원문/실제 고객값을 더 넣지 않는다. 구체 판정표와 공개 패키지는 [F08](features/08-reproduction.md)에 정의한다.

## 10. 팀이 새 확장을 추가할 때와 카탈로그 CLI

새 팩 작성 -> 내부용/공개용 지침 분리 -> schema/도구/검사 등록 -> 정상/경계/오류 예시 작성 -> 공개 결과와 권한 검토 -> digest 고정 -> catalog 등록 순서로 진행한다. 코드를 붙였다는 이유만으로 지원 제품 목록에 올리지 않고 실제 대상과 입력에서 시험한다.

현행 구현에서는 `node tools/pack-register.mjs --root <팩경로> --allowlist <허용목록> --catalog <카탈로그JSON>`으로 `FsSkillPackLoader.load()` 검증을 통과한 팩의 `manifest_sha256`과 `pack_sha256`을 로컬 카탈로그에 고정한다. `toyrecord-repro` 팩은 `assets/reproduction.v1.json`(`toyrecord_reproduction.v1`)과 운영자 설치 핀(`toyrecord_installation.v1`)을 `FsSkillPackLoader.verify()`로 대조한 뒤에만 `tools/oss-repro-smoke.mjs`에서 실행한다.

문서와 도구를 추가해도 `INV-03`, `INV-04`, `INV-07`, `INV-09`, `INV-12-16`은 유지한다. 필요한 권한 변경은 기능 파일에만 숨기지 말고 [spec](spec.md), [API](api.md), [ERD](ERD.md)를 같은 변경으로 갱신한다.

## 근거

- [S-EXT-01 Agent Skills specification](https://agentskills.io/specification) - 2026-10-31 확인. 파일 구조 관례 참고. SafeHandoff manifest와 실행 권한은 프로젝트 자체 계약이다.
- [S-EXT-02 Docker: None network driver](https://docs.docker.com/engine/network/drivers/none/) - 2026-10-31 확인.
- [S-EXT-03 RFC 5737](https://www.rfc-editor.org/info/rfc5737/) - 문서 예시용 IPv4 대역. 해당 자료를 공유해도 된다는 판단은 별도 사용자 결정과 문맥 검사로 한다.
