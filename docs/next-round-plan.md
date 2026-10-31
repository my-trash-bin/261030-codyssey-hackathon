# 다음 라운드 계획 (2026-10-31 정리)

세 계획 문서(`f07-extensions-plan.md`, `review-grounding-plan.md`, `oss-repro-smoke-plan.md`)에
흩어져 있던 "이번엔 빼는 것"을 한 곳에 모았다. 구현은 하지 않았다.

## 지금까지 남은 간극 전체 목록

| 항목 | 출처 | 크기/위험 |
| --- | --- | --- |
| `roleDocuments` → `RealCore` 프롬프트 연결 (`AnalyzeRequest`/`FactPack`에 팩 문서 자리 없음) | F07 2번 | 작음, 계약 확장 1회 필요 |
| `toyrecord-repro` 스킬 팩을 실제 catalog로 로딩해 OSS 스모크에 연결 | F07 6번 + OSS 계획 | **중간** — 로더·등록 CLI 재사용, 재현 명세와 운영자 등록 연결 계약 필요 |
| `check_doc_ip_context_v1` (`ProcessToolRunner` 첫 구현) | F07 4번 | 큼, 보안 판단 필요 |
| `scan_candidate_bundle_v1` | F07 5번 | 중간 |
| 역할×도구 권한 교집합(`resolveToolAccess`) 실제 연결 | F07 7번 | 큼, 실제 registry 없음 |
| F06 본체(서버 `rules` 테이블·scope 매칭·철회/만료 전파) | review-grounding 계획 | 큼, 별도 기능 |
| **`analyze()`(F02, 원자료 → candidate 자동 추출)** | OSS 계획 | **큼** — 지금까지 모든 실행에서 facts를 손으로 구성한 유일한 이유 |
| server task/decision HTTP API, client UI | round3-scope 이후 계속 미룸 | 큼 |

## 우선 후보: `toyrecord-repro` 스킬 팩을 실제로 로딩하게 연결

현재 `fixtures/skills/`에는 `vendorstore-support`만 있고 `toyrecord-repro` 팩은 아직 없다.
`contracts/catalog.example.json`의 toyrecord 항목은 설치되지 않은 설명용 예시다. 실제 등록 CLI가
생성하는 catalog는 `{id, version, manifest_sha256, pack_sha256, root}` 배열이며 image나 target
참조를 담지 않는다. 두 catalog 형식을 같은 계약으로 취급하지 않는다.

`tools/oss-repro-smoke.mjs`는 운영자 registration 파일에서 image digest를 읽고, target_pair_id와
합성 입력 등록은 스크립트에서 구성한다. skill-loader와 pack-register는 재사용할 수 있지만,
현재 `SkillManifest`에는 image digest·target 참조 필드가 없고 알 수 없는 필드는 검증기가 거부한다.
따라서 catalog에서 image를 바로 읽는 방식 대신 다음 경계를 먼저 고정한다.

### 연결 계약

- 팩: `manifest.json`의 product/purpose/tool/template ID와 역할별 문서를 사용한다. 공개 제품
  계약은 references에, 고정 target_pair_id·입력 계약·oracle 식별자는 별도 재현 명세 asset에 둔다.
  asset도 pack digest에 포함한다. manifest 필드를 임의로 추가하지 않고 asset의 고정 경로·버전·
  허용 필드·검증 규칙을 구현 전에 명시한다. 임의 명령·실행 경로·컨테이너 옵션은 받지 않는다.
- 설치: `pack-register.mjs`로 운영자가 제공한 ID 허용목록에 대해 검증하고 digest pin을 로컬
  catalog에 기록한다. 팩 자신의 선언을 허용목록으로 사용하지 않는다.
- 실행: `--catalog`에서 toyrecord-repro의 명시적으로 선택한 version을 찾고 `verify(root, pin)`로
  다시 로딩한다. 중복·모호한 선택·pin 불일치·필수 도구나 재현 명세 누락은 실행 전에 거부한다.
- image: 별도 운영자 등록에 pack pin·target_pair_id와 로컬 image의 정확한 sha256 digest를
  연결한다. 팩의 target 참조와 운영자 등록의 결합이 일치해야 실행한다. 팩이 image·실행 권한을
  스스로 승인할 수 없으며 digest를 실제 로컬 image와 대조하는 기존 runner 검사를 유지한다.
- 권한: `tool_ids`는 필요한 도구의 선언이다. 이것만으로 실행 권한을 부여하지 않는다. 기존
  합성 입력 grant와 공개 결과 승인 검사는 유지하고 역할×도구 권한 교집합의 일반화는 미룬다.
- 추적: 보고서와 transcript에 선택한 pack id/version/pack_sha256 및 고정 target 식별자를
  연결한다. 내부 설치 경로나 원자료·운영 비밀을 공개 메타데이터로 복사하지 않는다.

### 구현 순서와 검증

1. 재현 명세 asset과 운영자 등록의 최소 계약·오류 처리를 정의한다.
2. `fixtures/skills/toyrecord-repro/`에 manifest.json, SKILL.md, 역할별 references와 재현 명세를
   만든다. 이 단계는 RealCore 프롬프트 연결을 완료한 것으로 보지 않는다.
3. 로컬 catalog 등록 → 명시적 version 선택 → 실행 전 pin 검증 → 운영자 등록 대조를 연결한다.
   기존 `--registration` 경로와 새 `--catalog` 경로의 조합·필수 인수 규칙을 README와 API 문서에
   함께 적고 image/target 선택이 충돌하는 입력은 거부한다.
4. OSS 스모크에서 검증된 명세와 기존 합성 입력 결과로 registration을 구성하고, 보고서와
   transcript가 같은 선택 팩을 가리키도록 연결한다.
5. 결정적 회귀 검사로 정상 로딩, 팩 바이트 변경, 누락·중복·잘못된 version, 미등록 ID,
   필수 도구 누락, 재현 명세 오류, pack/target/image 등록 불일치 및 transcript 연결을 확인한다.
   실패한 경우 모델·Docker 실행 전 거부되는지 검사한다. 문장 의미나 모델 검토 pass 여부는
   회귀 판정 기준으로 삼지 않는다.
6. 실제 로컬 Docker와 fixture 모델로 4-run 결과 및 transcript 생성을 확인한다. 기존 세 seed
   사례(42/7/2026)를 재확인하고, 기존 승인 범위에서 실제 모델을 호출하는 실행은 회귀 검사와
   분리해 당시 결과와 한계를 기록한다. 과거 성공 기록을 새 연결의 성공 근거로 대신 쓰지 않는다.

이 작업은 팩 선택과 재현 등록의 연결까지다. task의 skill_set_hash 갱신·revision 증가·artifact
stale 전파(F07 6번 전체), 카탈로그 HTTP API, 역할별 지침의 실제 프롬프트 주입을 완료했다고
보고하지 않는다. OSS 계획에서 미뤘던 팩 연결 범위만 해소한다.

## 그 다음 큰 결정: `analyze()`(F02)

`analyze()`는 원자료에서 candidate를 자동 추출하는 미구현 단계다. 현재 사람이 스크립트에서
facts를 구성하는 주요 이유이며, 팩 연결 후에도 이 제한은 남는다. 공개 결정·팩 지침 연결·
최종화도 별도 간극으로 남는다. F02는 도구 호출 없는 LLM 처리와 서버측 파서(txt/log/md/csv
위치추적)를 포함한다. 위치 정확성과 원자료 경계 검증이 필요하므로 별도 라운드로 다룬다.
팩 연결 작업이 끝나면 이 구현을 시작할지 다시 판단한다.

## 이번에도 빼는 것

F06 본체, `check_doc_ip_context_v1`/`scan_candidate_bundle_v1`(ProcessToolRunner 일반화),
역할×도구 권한 교집합 실제 연결, server task HTTP API, client UI — 전부 이전과 같은 이유(보안
판단 필요 또는 더 큰 별도 작업)로 그대로 남긴다.
