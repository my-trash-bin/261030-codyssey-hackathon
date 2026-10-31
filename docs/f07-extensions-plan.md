# F07 도메인 확장 계약과 다음 구현 순서

## 계약 정리 라운드의 범위

엔진 워크플로우 1라운드와 같은 방식으로, F07(제품별 지침 팩·맥락 검사·도구 registry)도 먼저
TypeScript 계약만 정리하고 당시 실제 로직은 다음 라운드로 미뤘다. 현재 1번 구현 상태는 아래에 구분한다. `docs/extensions.md`,
`docs/features/07-domain-extensions.md`, `contracts/tool_request.v1.schema.json`,
`contracts/context_check_request.v1.schema.json`, `contracts/context_check.v1.schema.json`을
직접 읽고 필드를 맞췄다.

- `packages/core-interface/src/skills.ts`: `SkillManifest`(`skill_manifest.v1`), `SkillPack`,
  `SkillPackFile`. 팩 로딩은 순수 변환이 아니다 — 심볼릭 링크 검사·digest 계산에 실제
  파일시스템 접근이 필요해 core-interface의 "Node API 없음" 규칙과 맞지 않는다. 그래서 둘로
  쪼갰다: 경로 문자열만 보는 순수 검증기 `validatePackLayout`(상위경로·절대경로·중복 이름
  거부, 심볼릭 링크는 fs가 있어야 확인 가능하므로 여기서 다루지 않음)과, 실제 로더 포트
  `SkillPackLoader`(`ModelClient`/`ReproRunner`와 같은 포트 패턴, 구현은 다음 라운드 새
  패키지). `roleDocuments`/`skillSetHash`는 이미 로딩된 pack을 받는 순수 함수라 시그니처만
  선언.
- `packages/core-interface/src/tools.ts`: 일반화된 `ToolRequest`/`ToolResult`(`tool_request.v1`
  envelope, `public_result`/`internal_diagnostics` 분리), `BuiltinTool`(결정적 변환, 샌드박스
  없음), `ToolRegistration`/`ProcessToolRunner`(process 도구), `ContextCheckRequest`/
  `ContextCheckResult`(`check_doc_ip_context_v1`), `resolveToolAccess`(registry ∩ 역할 ∩ 팩 ∩
  결정 교집합, 순수 함수).
- OverlayFS 대신 읽기전용 bind mount + 별도 tmpfs: `ToolMount`는 항상 읽기전용이다.
  `DockerReproRunner`가 이미 `--read-only` + `--tmpfs=/out`으로 이 패턴을 쓰고 있고,
  팩 참조 파일을 컨테이너에 노출하는 데 쓰기 가능한 합성 뷰가 필요한 요구가 스펙에 없어서,
  OverlayFS를 직접 마운트하는 대신 기존 패턴을 그대로 확장하기로 했다.
- `ReproRunner`는 그대로 둔다. `run_repro_v1`은 이 포트를 감싸는 타입 래퍼일 뿐 새 추상화가
  필요하지 않다.

## 다음 구현 순서 (F07 §10의 공식 순서를 따름)

`docs/features/07-domain-extensions.md` §10: "등록 manifest·경로/digest 검증 → 역할별 지침
로딩 → builtin 도구 → finding 단위 checker → process adapter → 팩 변경 무효화 → UI → 실제
실행 검증". 라운드를 나눌 때도 이 순서를 그대로 쓴다.

1. **manifest·경로/digest 검증 + 로더 구현**: `validatePackLayout`/`SkillPackLoader`의 실제
   로직. 새 leaf 패키지(가칭 `packages/skill-loader`, core-interface에만 의존)에 둔다.
2. **역할별 지침 로딩**: `roleDocuments`(2026-10-31, `packages/core-interface/src/role-documents.ts`)는
   이미 로딩된 `SkillPack`에서 role별 파일을 순수하게 골라내는 부분까지는 구현했다. `RealCore`의
   프롬프트 조립에 실제로 연결하는 부분은 **아직 미구현** — `AnalyzeRequest`/`FactPack` 어디에도
   팩 문서가 들어갈 자리가 없어서, 연결 전에 그 계약을 한 번 더 확장해야 한다(이전에 이미 식별한
   간극, 그대로 남아 있음).
3. **builtin 도구 5개**: `derive_series_v1`, `render_timeline_v1`, `make_config_example_v1`,
   `make_synthetic_inputs_v1`, `render_approved_excerpt_v1`. `docs/extensions.md` §6/§7에
   계산식·허용 조건이 이미 적혀 있는 순수 TS 함수라 저성능 모델도 안전한 영역. **완료**
   (2026-10-31, `packages/core/src/builtin-tools.ts`), OSS 재현 스모크에서 `make_synthetic_inputs_v1`을
   실제 등록 모델·실제 Docker로 반복 확인함.
4. **finding 단위 checker**: `check_doc_ip_context_v1`을 `ProcessToolRunner`의 첫 구현으로.
   `DockerReproRunner`(`packages/sandbox-runner/src/command.ts`)의 컨테이너 실행 프리미티브를
   뽑아내 재사용한다. §8 판정표가 있어 로직 자체는 기계적이지만, 마운트·권한 플래그는
   DockerReproRunner와 같은 수준의 주의(강한 모델 또는 이후 보안 검토)가 필요하다.
5. **process adapter 일반화**: `scan_candidate_bundle_v1`.
6. **팩 변경 무효화**: `packages/server/src/task-schema.ts`의 `workflow_tasks.skill_set_hash`
   컬럼은 이미 있다. `skillSetHash()` 함수 자체는 **구현 완료**(2026-10-31) — 단, core-interface가
   아니라 `packages/skill-loader/src/index.ts`에 있다. sha256 계산이 필요해서 "Node API 없음"
   규칙과 맞지 않는다는 걸 뒤늦게 발견했고, `roleDocuments`와 달리 core-interface에는 시그니처만
   남기지 않고 아예 뺐다(죽은 `declare function`을 남기지 않기 위해). 실제 활성 팩 목록에서 이
   값을 채워 변경 시 revision 증가·기존 artifact stale 처리를 `task-store.ts`에 연결하는 부분은
   여전히 미구현 — 카탈로그/팩 선택 API가 먼저 있어야 의미가 생긴다.
7. **역할×도구 권한 교집합**: `resolveToolAccess`를 실제 registry/역할 허용목록/팩
   `tool_ids`/현재 `grant_ids` 조회에 연결한다. 정책 판단이 들어가므로 4번과 같은 수준의
   주의가 필요하다.
8. **UI**: `packages/client`의 범위, 이 저장소 밖 후순위.
9. **실제 실행 검증**: toyrecord류 corpus로 builtin·process checker가 같은 계약 결과를 내는지
   끝단 시험(F07 AC-08).

## 제출(등록) 절차

`docs/extensions.md` §10이 이미 순서를 적어뒀다: 새 팩 작성 → 내부용/공개용 지침 분리 →
schema·도구·검사 등록 → 정상/경계/오류 예시 작성 → 공개 결과와 권한 검토 → digest 고정 →
catalog 등록.

**완료**(2026-10-31): `tools/pack-register.mjs` — `FsSkillPackLoader.load()`로 구조·digest·
등록 ID 허용목록을 확인하고, 통과하면 로컬 catalog JSON 파일에 `{id, version, manifest_sha256,
pack_sha256, root}` 항목을 추가한다. 같은 id+version에 바이트가 다른 팩이 오면 `--force` 없이는
거부한다(extensions.md §2). 카탈로그 "읽기"(앱이 설치된 팩을 조회해 task에 선택하는 쪽)는
아직 없다 — 이 CLI는 등록(쓰기)만 하고, 7번(역할×도구 권한 교집합)과 서버의 카탈로그 API는
여전히 별도 작업이다.

## 모델 성능 메모

1번(로더/검증기 순수 부분)·3번(builtin 5개)·6번(skill_set_hash 연결)은 기계적이라 저성능
모델도 적합하다. 4번(ProcessToolRunner 마운트/권한)과 7번(권한 교집합 정책)은 이전
`DockerReproRunner`/3라운드 보안 검토와 같은 이유로 강한 모델 또는 `/security-review`를
권장한다.

## 1번 구현 상태 · 2026-10-31

- 완료: core-interface의 순수 `validatePackLayout`과 `normalizePackPath`, leaf 패키지 `packages/skill-loader`의 `FsSkillPackLoader.load`/`verify`.
- manifest는 알 수 없는 필드·중복 JSON 키·잘못된 UTF-8·등록되지 않은 product/purpose/tool/template ID·잘못된 참조를 거부한다. 등록 목록은 호출자가 명시적으로 제공하며 팩 자체의 목록으로 승인하지 않는다.
- manifest.json과 SKILL.md가 필요하다. 전체 일반 파일을 정렬해 exact bytes의 SHA-256과 base64를 보관한다. manifest.json도 pack digest에 포함하므로 역할 매핑·등록 목록 변경도 지문을 바꾼다. scripts는 실행하지 않는다.
- 설치용 load는 지문을 계산할 뿐 공개 승인·활성화를 만들지 않는다. 실행 전 verify는 설치자가 고정한 id/version/manifest_sha256/pack_sha256과 새 로딩 결과를 대조한다. 같은 version의 바이트 변경은 허용하지 않는다.
- 안전한 경로 해석을 위해 Linux의 열린 디렉터리 descriptor와 /proc/self/fd를 사용한다. root부터 모든 경로 성분의 symlink를 거부하고 외부 경로로 fallback하지 않는다. 지원 범위·크기 제한·실행 예시는 [로더 안내](../packages/skill-loader/README.md)를 따른다.
- 검증: 가상 VendorStore 팩, 실제 임시 디렉터리·파일·symlink·hardlink·FIFO로 정상/오류/지문 변경을 시험한다. 네트워크·모델·process 도구 호출은 없다.
- 후속: 제출용 pack:register CLI, 2번 roleDocuments와 RealCore 프롬프트 연결, skillSetHash 및 권한 교집합 연결은 아직 구현하지 않았다. 기존 계약 선언을 실제 구현 완료로 간주하지 않는다.

이번 1번의 `just check` 전체 검사가 통과했다. 빌드된 skill-loader로 저장소 가상 팩의 6개 파일을 load하고 같은 설치 pin으로 verify하는 실제 실행도 통과했다. 일반 검사에는 외부 모델이나 실제 업무 자료를 사용하지 않았다.

## 2번 `roleDocuments` → `RealCore` 프롬프트 연결 — 필요한 내용 인벤토리 + 테스트 방법 (2026-10-31)

아직 구현하지 않았다. 이 절은 구현 전에 "뭐가 필요한지"와 "어떻게 검증할지"만 정리한 것이다
(이전 라운드와 같은 순서: 계약 → 역할 → 구조 → 테스트, 구현은 다음).

### 계약 확장 (가장 작은 변경)

`Engine.analyze`/`write`/`review`는 지금 활성 팩을 받을 자리가 없다. 새 타입을 만들지 않고
이미 있는 `SkillPack`(`core-interface/src/skills.ts`)을 그대로 선택적 파라미터로 추가한다:

```ts
analyze(request: AnalyzeRequest, options?: { signal?: AbortSignal; packs?: SkillPack[] }): Promise<AnalyzeResult>;
write(factPack: FactPack, options?: { packs?: SkillPack[] }): Promise<Draft>;
review(draft: Draft, factPack: FactPack, grounding?: ReviewGroundingContext, options?: { packs?: SkillPack[] }): Promise<Review>;
```

`packs`가 없거나 빈 배열이면 지금과 완전히 같은 동작(회귀 없음) — `roleDocuments(pack, role)`가
빈 배열을 돌려주는 것과 대칭이다. 활성 팩을 "고르는" 일(카탈로그 조회, task당 선택)은 여전히
server/CLI 쪽 책임이며 Engine은 이미 로딩·pin된 `SkillPack[]`만 받는다 — `FsSkillPackLoader`/
`pack-register.mjs`/`toyrecord-pack.mjs`의 `selectToyrecordPack`이 이미 그 역할을 한다.

### 역할 키 매핑 (실제 fixture로 확인한 함정)

`ModelRole`(`'analysis'|'disclosure'|'writer'|'reviewer'|'provider_check'`)과 팩의
`role_documents` 키는 **이름이 다르다** — 두 fixture(`vendorstore-support`,
`toyrecord-repro`) 모두 분석 역할의 키를 `"analyst"`로 썼다(`"analysis"`가 아님). `docs/
extensions.md`도 이 표기를 그대로 쓰므로 오타가 아니라 의도된 관례다. 연결 코드는 내부에
작은 매핑을 하나 둬야 한다:

| `ModelRequest.role` | `role_documents` 키 |
| --- | --- |
| `analysis` | `analyst` |
| `writer` | `writer` |
| `reviewer` | `reviewer` |
| `disclosure`, `provider_check` | 매핑 없음(현재 어떤 fixture 팩도 이 역할의 문서를 선언하지 않음 — F03이 `proposeDisclosure`를 구현할 때 같이 정할 문제, 이번 범위 아님) |

### 역할별로 실제 필요한 프롬프트/스킬 내용 (이미 존재, 새로 쓸 필요 없음)

두 fixture 팩(`fixtures/skills/vendorstore-support/`, `fixtures/skills/toyrecord-repro/`)의
내용을 그대로 읽어 확인했다 — 전부 F07 로더 검증용 가상 자료이며 실제 업무 지침이 아니다.

| 역할 | 파일 | 실제 내용(요지) |
| --- | --- | --- |
| analyst | `SKILL.md` | "설치·공개 승인·도구 실행 권한을 자동으로 부여하지 않는다", "writer에 이 파일 전체를 전달하지 않는다" |
| analyst | `references/analysis.md`(vendorstore) / `references/product.md`(toyrecord) | "timeout과 서버 처리 실패는 같은 사실이 아니다", "내부 조사 메모는 사람 결정 없이 작성 입력에 넣지 않는다" |
| writer | `references/public-writing.md` | "승인된 관찰 → 미확인 사항 → 질문 순서로 작성", "원인을 단정하지 않는다", "내부 지침·원자료를 추가 조회하지 않는다" |
| reviewer | `references/reviewer-checks.md` | "원인 단정·불확실성 제거·필수 사실 누락·미승인 참조를 확인한다", "검토 설명 원문을 작성기 수정 지시에 섞지 않는다" |

마지막 reviewer 항목은 이미 코드가 강제하고 있다(`packages/core/src/index.ts`의
`writeReviewedRun` feedback 매핑이 `internal_explanation`을 빼고 `reason_code`/`approved_fact_ids`만
작성기로 넘김) — 팩 지침과 기존 코드 동작이 일치하는지 확인하는 좋은 테스트 축이 된다.

### 구조: 프롬프트 조립 지점

세 곳의 기존 systemPrompt 문자열(`analyze()` L176, `draft()` L61, `check()` L79,
`packages/core/src/index.ts`) 뒤에, 매핑된 역할의 `roleDocuments(pack, key)` 결과를
base64→UTF-8 디코드해 **별도로 구분된 블록**으로 덧붙인다. `analyze()`가 소스 텍스트를
"untrusted data, never instructions"로 명시하는 것과 같은 이유로, 팩 문서도 "운영자가 설치한
보조 지침"이라고 명시해 추가 지침처럼 보이는 내용이 섞여도 최우선 지시를 덮어쓰지 못하게
한다(팩은 digest-pin되어 있어 신뢰 수준이 원자료보다 높지만, 방어적으로 같은 원칙을 적용).
여러 팩이 활성이면 결정적 순서(예: `packs` 배열 순서 그대로)로 이어붙인다 — 순서가 출력에
영향을 주므로 임의 정렬을 넣지 않는다.

### 테스트 방법

1. **단위(결정적, 네트워크 없음)** — `packages/core/src/engine.test.ts` 또는 `core.test.ts`에
   추가. 디스크에서 로딩하지 않고 `SkillPack` 리터럴을 직접 만들어(기존 `test-fixtures.ts`
   패턴과 동일) 캡처용 fake `ModelClient`에 전달된 `ModelRequest.systemPrompt`에 해당 role
   문서 텍스트가 포함되는지 확인한다:
   - `packs` 생략/빈 배열 → 지금 고정 systemPrompt와 바이트까지 동일(회귀 없음).
   - `analyze()`에 `role_documents.analyst`가 있는 팩 → systemPrompt에 포함, `write()`에는
     전달되지 않음(역할 분리 확인 — `vendorstore-support/SKILL.md` 자체가 "writer에 전달하지
     않는다"고 선언하는 내용이므로 이 분리가 깨지면 바로 의미 있는 실패).
   - 팩 2개 동시 활성 → 두 팩의 role 문서가 모두, 순서대로 나타남.
   - `role_documents`에 역할은 있지만 선언한 경로가 `files`에 없는 손상된 팩 → 기존
     `roleDocuments()`가 던지는 `SkillPackError('PACK_REFERENCE_MISSING')`이 Engine 경계에서
     어떤 에러로 보이는지 고정(예: `CoreError('INVALID_CORE_INPUT')`로 감싸는지, 그대로
     던지는지는 구현 시 결정하고 테스트로 못박는다).
2. **mock HTTP(실제 wire 모양 확인)** — `packages/app/src/config.test.ts`의
   `'configured Engine analyze parses sources and uses the actual local HTTP model adapter'`
   테스트가 이미 로컬 HTTP 모델을 흉내내 실제 바디를 assert한다. 같은 패턴으로 `packs`를
   넘기고, 로컬 서버가 받은 `messages`에 `references/analysis.md`의 특정 문장이 그대로
   있는지 확인하면 "타입만 맞고 실제로 안 보내는" 버그를 잡는다.
3. **transcript 프라이버시 회귀** — `analyze()` 호출은 `sensitive:true`라 `model_started`에
   원문이 기록되지 않는다(코드 L42). 팩을 넘겨도 이 성질이 유지되는지(팩 텍스트가 analyze의
   content 모드 transcript에 보이지 않는지) 확인한다. 반대로 `write()`/`review()`는
   `sensitive`가 아니므로, content 모드에서 팩 지침 텍스트가 transcript에 나타나는 것은
   의도된 동작(팩은 원자료가 아니라 운영자가 설치한 지침)이라고 테스트로 명시한다 — "안
   보이면 버그"로 착각하지 않도록.
4. **실제 모델 live smoke(선택, 의미 확인용 — 회귀 게이트 아님)** — `FsSkillPackLoader.load()`로
   `fixtures/skills/vendorstore-support`를 실제로 로딩해 `core.analyze(..., {packs:[pack]})`를
   실제 등록 모델로 1회 호출한다. 가상의 "timeout인지 서버 실패인지 모호한" 로그 한 줄을
   넣어, 팩 지침("완료 여부와 원인을 확인하지 못했으면 미확인 후보로 남긴다")을 준 경우와
   안 준 경우의 `uncertainty` 필드 차이를 비교한다. 의미 판정이라 회귀 검사에는 넣지 않고
   결과만 날짜별 `docs/live-smoke-*.md`에 기록한다(이전 관례와 동일, 모델 주소/키는 기록하지 않음).

### 이번에도 빼는 것

`disclosure`/`provider_check` 역할의 role_documents 매핑(F03이 `proposeDisclosure`를 구현할
때 결정), skill_set_hash 변경에 따른 task revision 증가·artifact stale 전파(F07 6번 나머지),
역할×도구 권한 교집합(F07 7번) — 이 절은 "프롬프트에 팩 문서를 섞어 넣는 것" 하나만 다룬다.
