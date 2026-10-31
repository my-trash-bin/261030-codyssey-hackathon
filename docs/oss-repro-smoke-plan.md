# OSS 재현 사례 end-to-end 확인 계획

## 목적

"인터넷 차단된 샌드박스의 에이전트 기반 시스템이 재현 가능한 오픈소스 프로젝트 사례에서 유의미한
출력을 내는지"를 실제로 확인한다. 조사해보니 필요한 합성 데이터는 대부분 이미 저장소에 있다 —
새로 만들 게 아니라 **연결**하는 작업이다.

- `docs/test-data.md` A절: `labelapp`이 `toyrecord 0.1.0-demo`로 문자열을 저장하는데 ASCII는 되고
  한글은 인코딩 단계에서 실패하는 가상 OSS 버그 시나리오(원자료: `fixtures/reference-pack/author/oss-encoding/{app-log.txt,incident-notes.md,observations.csv,sample-input.json}`).
- `var/runners/targets.json`/`checker.json`: 실제로 로컬에 빌드되어 있는 등록 이미지(`safehandoff-runner:local`,
  `docker image inspect`로 확인됨)의 digest.
- `fixtures/public/targets/toyrecord/inputs/{ascii,multibyte}.json`: 기존 합성 입력 예시(`QWERTY`/`하늘바다나무`).

## 계획

### 1. builtin 도구 5개 (`extensions.md` §6/§7, 순수 TS)

새 모듈(가칭 `packages/core/src/builtin-tools.ts`, `BuiltinTool` 인터페이스 구현):

- `make_synthetic_inputs_v1(seed, codepoint_count)` — **이번 시나리오에 직접 쓰임**. `tool_request.v1`의
  예시 `arguments: {seed, codepoint_count}`가 바로 이 도구의 것이었다(지난 조사에서 확인). seed로
  결정적으로 새 ASCII 대문자 문자열 + 새 한글 문자열을 같은 코드포인트 수로 생성한다. "원래 비밀값·길이
  자동 보존 금지"(§9) 원칙을 지켜야 하므로 원본 문자열을 변형하는 게 아니라 완전히 새로 생성한다.
- `derive_series_v1`, `render_timeline_v1`, `make_config_example_v1`, `render_approved_excerpt_v1` —
  이번 시나리오엔 직접 안 쓰이지만 §6/§7에 계산식·허용 조건이 이미 적혀 있어 저성능 모델도 안전한
  영역이고, F07 계획의 "builtin 5개" 단계를 한 번에 끝낸다.
- 각 도구는 §6/§7/§9의 정상·경계 사례(빈 값, 0 baseline, 자리수 초과, 코드포인트 1~8 범위 등)를
  단위테스트로 포함한다.

### 2. OSS 재현 end-to-end 스모크 스크립트 (새 파일)

- `fixtures/reference-pack/author/oss-encoding/*` 원자료를 읽고, `docs/test-data.md` A-1/A-2 내용대로
  facts를 구성한다(ASCII 저장 성공, 한글은 encode 단계에서 `E_ENCODE_SHORT_BUFFER`로 실패). `analyze()`는
  미구현이므로 이 단계는 스크립트가 "analyst가 이미 분석을 끝냈다"고 가정하고 직접 구성한다 — 이 점을
  결과 기록에 명시한다.
- 승인(disclosure decision)도 그 자리에서 즉시 `allow`로 하드코드한다(사람 승인 UI는 범위 밖).
- `make_synthetic_inputs_v1`로 새 ascii/multibyte 입력을 생성하고, `var/runners/targets.json`의 실제
  로컬 digest로 `DockerRegistration`을 구성해 `DockerReproRunner.reproduce()`를 **실제로 호출**한다
  (진짜 Docker, `--network=none`, 이미 로컬에 빌드된 이미지).
- 반환된 실제 `ReproduceResult`를 `FactPack.public_tool_results`(`{status, reason_code}`)에 반영하고,
  `RealCore.write()`+`review()`를 **실제 등록 모델로** 호출한다(1·2차 live smoke로 이미 검증된 경로).
- 최종 문서가 재현 성공/실패를 정확히 반영하는지(단정하지 않아야 할 부분을 단정하지 않는지) 확인한다.
- 결과를 비밀값 없이 `docs/live-smoke-<날짜>c.md`에 기록한다(기존 파일 덮어쓰지 않음).

### 3. 이번엔 빼는 것

- `analyze()`(F02, 원자료 → candidate 자동 추출)는 미구현 상태로 둔다. 큰 별도 작업(서버측 파서
  위치추적 포함)이라 "샌드박스+에이전트가 유의미한 출력을 내는지" 확인엔 필수가 아니다.
- 공개결정(사람 승인) UI도 하드코드 승인으로 대체한다.
- F07 `toyrecord-repro` 스킬 팩(manifest 기반 선택)으로 연결하는 것도 이번엔 빼고, registration을
  스크립트가 직접 구성한다 — `skill-loader`와의 통합은 catalog/활성화 단계(f07-extensions-plan.md
  6·7번)가 먼저 있어야 의미가 있다.

## 검증

- 2번 스크립트의 실행 자체가 검증이다(각 단계 상태코드·응답·재현 판정을 기록).
- 1번 builtin 도구는 단위테스트 + `pnpm typecheck && pnpm test && just check`로 기존 계약 무회귀 확인.

## 구현 상태 · builtin과 스모크

builtin 5개와 tools/oss-repro-smoke.mjs를 구현했다. builtin 실행은 task/revision, 설치자가 검증해 전달한 grant ID와 인수 hash에 묶인다. 변환 자체나 요청 문자열이 공개 결정을 생성하지 않는다. count 지수는 BigInt 유리수 HALF_UP, 인용은 UTF-8 바이트 경계와 원본/렌더 hash를 검증한다.

스모크는 기존 legacy var/runners 등록을 추정하지 않고 현재 sandbox_observation.v1 supervisor 이미지의 전체 ID를 담은 명시적 등록 파일을 요구한다. --live-model이 없으면 fixture 모델임을 기록한다. Docker 실행은 항상 실제 runner이며 mock runner는 자동 테스트에서만 주입한다. reproduction_evidence 목표가 충족되지 않으면 모델을 호출하지 않고 미완료로 끝낸다. 출력은 새 파일만 생성하며 기존 결과를 덮어쓰지 않는다.

기존 등록 모델과 가상 승인 요약으로 첫 실제 실행에서 reproduced/pass를 확인했다. analysis와 decision 단계는 여전히 fixture 가정이며 원자료 문자열·내부 경로·가상 인증 표식은 모델 입력과 결과에서 거부한다. grounding 계획의 추가 검증은 다음 중간 커밋에서 연결한다.
