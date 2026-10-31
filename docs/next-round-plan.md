# 다음 라운드 계획 (2026-10-31 정리)

세 계획 문서(`f07-extensions-plan.md`, `review-grounding-plan.md`, `oss-repro-smoke-plan.md`)에
흩어져 있던 "이번엔 빼는 것"을 한 곳에 모았다. ToyRecord 팩 연결과 F02 Engine/분석 HTTP/내부 job/CAS/수동 후보는 이후 구현했다. 전체 UI/task HTTP/Rule과 아래 개별 후속은 남아 있다.

## 지금까지 남은 간극 전체 목록

| 항목 | 출처 | 크기/위험 |
| --- | --- | --- |
| `roleDocuments` -> `RealCore` 프롬프트 연결 (`AnalyzeRequest`/`FactPack`에 팩 문서 자리 없음) | [F07 2번 - 인벤토리+테스트 방법 정리 완료](f07-extensions-plan.md), 구현은 아직 | 작음, 계약 확장 1회 필요 |
| `toyrecord-repro` 스킬 팩을 실제 catalog로 로딩해 OSS 스모크에 연결 | F07 6번 + OSS 계획 | **연결 완료** - task 변경 무효화는 별도 |
| `check_doc_ip_context_v1` (`ProcessToolRunner` 첫 구현) | F07 4번 | 큼, 보안 판단 필요 |
| `scan_candidate_bundle_v1` | F07 5번 | 중간 |
| 역할*도구 권한 교집합(`resolveToolAccess`) 실제 연결 | F07 7번 | 큼, 실제 registry 없음 |
| F06 본체(서버 `rules` 테이블/scope 매칭/철회/만료 전파) | review-grounding 계획, [제안 검색 메모](f06-rule-reuse-plan.md) | 큼, 별도 기능 |
| `analyze()`(F02) 서버/UI 연결 | [Engine 범위](f02-analyze-plan.md) | **Engine + stateless HTTP + 내부 job/CAS/수동 후보 완료** - task HTTP/UI는 후속 |
| server task/decision HTTP API, client UI | round3-scope 이후 계속 미룸 | `POST /api/analysis`는 생김(동기, task 저장 없음). task/decision CRUD는 여전히 없음 - 큼 |

## 구현 완료: `toyrecord-repro` 스킬 팩을 실제로 로딩하게 연결

아래 계약과 순서에 따라 `tools/toyrecord-pack.mjs`, 팩 fixture, OSS CLI 연결을 구현했다.
[설치/실행 안내](toyrecord-pack.md)와 [실제 Docker 세 사례 확인](toyrecord-pack-smoke-2026-10-31.md)을
참고한다. 기존 `--registration` 경로도 유지하며 모델 의미 판정을 회귀 검사에 넣지 않았다.

### 구현 전 확인한 간극

연결 작업 전 `fixtures/skills/`에는 `vendorstore-support`만 있었고 `toyrecord-repro` 팩이 없었다.
`contracts/catalog.example.json`의 toyrecord 항목은 설치되지 않은 설명용 예시다. 실제 등록 CLI가
생성하는 catalog는 `{id, version, manifest_sha256, pack_sha256, root}` 배열이며 image나 target
참조를 담지 않는다. 두 catalog 형식을 같은 계약으로 취급하지 않는다.

`tools/oss-repro-smoke.mjs`는 운영자 registration 파일에서 image digest를 읽고, target_pair_id와
합성 입력 등록은 스크립트에서 구성한다. skill-loader와 pack-register는 재사용할 수 있지만,
현재 `SkillManifest`에는 image digest/target 참조 필드가 없고 알 수 없는 필드는 검증기가 거부한다.
따라서 catalog에서 image를 바로 읽는 방식 대신 다음 경계를 먼저 고정한다.

### 연결 계약

- 팩: `manifest.json`의 product/purpose/tool/template ID와 역할별 문서를 사용한다. 공개 제품
  계약은 references에, 고정 target_pair_id/입력 계약/oracle 식별자는 별도 재현 명세 asset에 둔다.
  asset도 pack digest에 포함한다. manifest 필드를 임의로 추가하지 않고 asset의 고정 경로/버전/
  허용 필드/검증 규칙을 구현 전에 명시한다. 임의 명령/실행 경로/컨테이너 옵션은 받지 않는다.
- 설치: `pack-register.mjs`로 운영자가 제공한 ID 허용목록에 대해 검증하고 digest pin을 로컬
  catalog에 기록한다. 팩 자신의 선언을 허용목록으로 사용하지 않는다.
- 실행: `--catalog`에서 toyrecord-repro의 명시적으로 선택한 version을 찾고 `verify(root, pin)`로
  다시 로딩한다. 중복/모호한 선택/pin 불일치/필수 도구나 재현 명세 누락은 실행 전에 거부한다.
- image: 별도 운영자 등록에 pack pin/target_pair_id와 로컬 image의 정확한 sha256 digest를
  연결한다. 팩의 target 참조와 운영자 등록의 결합이 일치해야 실행한다. 팩이 image/실행 권한을
  스스로 승인할 수 없으며 digest를 실제 로컬 image와 대조하는 기존 runner 검사를 유지한다.
- 권한: `tool_ids`는 필요한 도구의 선언이다. 이것만으로 실행 권한을 부여하지 않는다. 기존
  합성 입력 grant와 공개 결과 승인 검사는 유지하고 역할*도구 권한 교집합의 일반화는 미룬다.
- 추적: 보고서와 transcript에 선택한 pack id/version/pack_sha256 및 고정 target 식별자를
  연결한다. 내부 설치 경로나 원자료/운영 비밀을 공개 메타데이터로 복사하지 않는다.

### 구현 순서와 검증

1. 재현 명세 asset과 운영자 등록의 최소 계약/오류 처리를 정의한다.
2. `fixtures/skills/toyrecord-repro/`에 manifest.json, SKILL.md, 역할별 references와 재현 명세를
   만든다. 이 단계는 RealCore 프롬프트 연결을 완료한 것으로 보지 않는다.
3. 로컬 catalog 등록 -> 명시적 version 선택 -> 실행 전 pin 검증 -> 운영자 등록 대조를 연결한다.
   기존 `--registration` 경로와 새 `--catalog` 경로의 조합/필수 인수 규칙을 README와 API 문서에
   함께 적고 image/target 선택이 충돌하는 입력은 거부한다.
4. OSS 스모크에서 검증된 명세와 기존 합성 입력 결과로 registration을 구성하고, 보고서와
   transcript가 같은 선택 팩을 가리키도록 연결한다.
5. 결정적 회귀 검사로 정상 로딩, 팩 바이트 변경, 누락/중복/잘못된 version, 미등록 ID,
   필수 도구 누락, 재현 명세 오류, pack/target/image 등록 불일치 및 transcript 연결을 확인한다.
   실패한 경우 모델/Docker 실행 전 거부되는지 검사한다. 문장 의미나 모델 검토 pass 여부는
   회귀 판정 기준으로 삼지 않는다.
6. 실제 로컬 Docker와 fixture 모델로 4-run 결과 및 transcript 생성을 확인한다. 기존 세 seed
   사례(42/7/2026)를 재확인하고, 기존 승인 범위에서 실제 모델을 호출하는 실행은 회귀 검사와
   분리해 당시 결과와 한계를 기록한다. 과거 성공 기록을 새 연결의 성공 근거로 대신 쓰지 않는다.

이 작업은 팩 선택과 재현 등록의 연결까지다. task의 skill_set_hash 갱신/revision 증가/artifact
stale 전파(F07 6번 전체), 카탈로그 HTTP API, 역할별 지침의 실제 프롬프트 주입을 완료했다고
보고하지 않는다. OSS 계획에서 미뤘던 팩 연결 범위만 해소한다.

## F02 Engine 구현 이후

근거 파서/후보 strict 검증/`RealCore.analyze()`는 [F02 범위](f02-analyze-plan.md)로 구현했다.
현재 OSS 스모크는 여전히 수동 fixture 후보를 사용하며 이 함수로 자동 전환하지 않았다.
서버 내부 source snapshot/job/CAS/candidate_set 채택/모델 없는 수동 후보도 구현했다. HTTP 분석은 stateless로 유지하며 내부 저장 자동 연결/task CRUD/수동 후보 UI/공개 결정과 최종화가 남는다.
역할별 팩 프롬프트 주입/Rule 적용도 이 완료 범위에 포함하지 않는다.

## 이번에도 빼는 것

F06 본체, `check_doc_ip_context_v1`/`scan_candidate_bundle_v1`(ProcessToolRunner 일반화),
역할*도구 권한 교집합 실제 연결, server task HTTP API, client UI - 전부 이전과 같은 이유(보안
판단 필요 또는 더 큰 별도 작업)로 그대로 남긴다.


다음 연결 작업은 [F03 계획](f03-plan.md)의 제안/미리보기 계약과 내부 후보/결정 저장의 접점이다.
인증/CSRF/Host/Origin/판본 규칙을 정리하기 전에 task CRUD를 임의로 노출하지 않는다. 역할별
모델 예산/실제 모델 length 종료와 roleDocuments 주입도 별도 검증 대상으로 유지한다.


## UI 요청 후속 구현

인증된 단일 운영자 loopback task HTTP/분석 job/미리보기/결정/철회와 CSV/JSON 선택 필드 변환을
구현했다. 위 server task HTTP 제외 문구는 당시 범위 기록이다. 현재 남은 화면 로그인/task 저장/
C 선택 연결과 원문/타임라인/Rule/최종화는 [요청 현황](ui-api-requests.md)을 따른다.
