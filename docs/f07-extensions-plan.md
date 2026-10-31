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
