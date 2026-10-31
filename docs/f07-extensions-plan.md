# F07 도메인 확장 계약과 다음 구현 순서

## 이번 라운드: 계약만

엔진 워크플로우 1라운드와 같은 방식으로, F07(제품별 지침 팩·맥락 검사·도구 registry)도 먼저
TypeScript 계약만 정리하고 실제 로직은 다음 라운드로 미룬다. `docs/extensions.md`,
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
2. **역할별 지침 로딩**: `roleDocuments`로 writer에는 `public-writing.md`류만, analyst에는
   `SKILL.md`+`references/`까지 전달하도록 `RealCore`의 프롬프트 조립에 연결한다.
3. **builtin 도구 5개**: `derive_series_v1`, `render_timeline_v1`, `make_config_example_v1`,
   `make_synthetic_inputs_v1`, `render_approved_excerpt_v1`. `docs/extensions.md` §6/§7에
   계산식·허용 조건이 이미 적혀 있는 순수 TS 함수라 저성능 모델도 안전한 영역.
4. **finding 단위 checker**: `check_doc_ip_context_v1`을 `ProcessToolRunner`의 첫 구현으로.
   `DockerReproRunner`(`packages/sandbox-runner/src/command.ts`)의 컨테이너 실행 프리미티브를
   뽑아내 재사용한다. §8 판정표가 있어 로직 자체는 기계적이지만, 마운트·권한 플래그는
   DockerReproRunner와 같은 수준의 주의(강한 모델 또는 이후 보안 검토)가 필요하다.
5. **process adapter 일반화**: `scan_candidate_bundle_v1`.
6. **팩 변경 무효화**: `packages/server/src/task-schema.ts`의 `workflow_tasks.skill_set_hash`
   컬럼은 이미 있다 — 실제 활성 팩의 `skillSetHash()` 값을 채우고, 변경 시 revision 증가·
   기존 artifact stale 처리를 `task-store.ts`에 연결한다.
7. **역할×도구 권한 교집합**: `resolveToolAccess`를 실제 registry/역할 허용목록/팩
   `tool_ids`/현재 `grant_ids` 조회에 연결한다. 정책 판단이 들어가므로 4번과 같은 수준의
   주의가 필요하다.
8. **UI**: `packages/client`의 범위, 이 저장소 밖 후순위.
9. **실제 실행 검증**: toyrecord류 corpus로 builtin·process checker가 같은 계약 결과를 내는지
   끝단 시험(F07 AC-08).

## 제출(등록) 절차

`docs/extensions.md` §10이 이미 순서를 적어뒀다: 새 팩 작성 → 내부용/공개용 지침 분리 →
schema·도구·검사 등록 → 정상/경계/오류 예시 작성 → 공개 결과와 권한 검토 → digest 고정 →
catalog 등록. 수작업 체크리스트로 두지 말고 `pnpm run pack:register <dir>` 같은 작은 CLI로
자동화한다 — `validatePackLayout` + `SkillPackLoader.load()`로 구조·digest를 확인하고, 통과하면
로컬 catalog 설정 파일에 항목을 추가한다. 이 CLI 자체는 1번(로더 구현) 다음에 바로 뒤따르는
작업이다.

## 모델 성능 메모

1번(로더/검증기 순수 부분)·3번(builtin 5개)·6번(skill_set_hash 연결)은 기계적이라 저성능
모델도 적합하다. 4번(ProcessToolRunner 마운트/권한)과 7번(권한 교집합 정책)은 이전
`DockerReproRunner`/3라운드 보안 검토와 같은 이유로 강한 모델 또는 `/security-review`를
권장한다.
