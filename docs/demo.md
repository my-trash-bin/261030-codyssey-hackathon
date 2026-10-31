# SafeHandoff 시연 및 실행 안내

문서 버전: 2.0 / 기준일: 2026-10-31 / 상태: 현행 정본 (TypeScript 워크스페이스 기준) / 연결: [README.md](../README.md), [api.md](api.md), [uj.md](uj.md)

## 1. 시연 모드 구분과 투명성 원칙

SafeHandoff는 심사위원과 사용자가 **실제 동작하는 코드**와 **화면 연출/고정 응답 모드**를 혼동하지 않도록 실행 경로를 명확히 분리한다 (`INV-14`).

| 실행 경로 | 실행 명령 | 포트 | 동작 내용과 표시 |
| --- | --- | --- | --- |
| 1. 실제 앱 (`@safehandoff/app`) | `just app` (또는 `pnpm --filter @safehandoff/app start`) | `127.0.0.1:8080` | `RealCore` + OpenAI 호환 모델 어댑터(`HttpModelClient`) + SQLite(`node:sqlite`) 실행. `/api/core/status`, `/api/core/generate`, `/api/documents` 제공 |
| 2. 연출용 앱 (`@safehandoff/fake-app`) | `just fake-app` | `127.0.0.1:8081` | 외부 LLM 없이 고정 시나리오 응답(`FakeCore`)과 상태 제어(`POST /__demo`)를 제공. 실제 모델 추론 완료로 집계하지 않음 |
| 3. 웹 클라이언트 (`@safehandoff/client`) | `just client` / `just client-fake` | `127.0.0.1:5173` / `:5174` | React 19 + Vite UI. 상단 배지로 코어 준비 상태(`ready`)와 연결 모드를 실시간 표시 |
| 4. OSS 재현/작성/검토 종단간 스모크 | `node tools/oss-repro-smoke.mjs ...` | CLI | `make_synthetic_inputs_v1` -> `DockerReproRunner`(`--network=none`, 4회 실행) -> `composeFactPack` + `groundFacts` -> `RealCore.writeReviewed()` 실행 |
| 5. 3자 가치 비교 실험 | `node tools/value-comparison.mjs` | CLI | 가상 로그 10건(`cases.json`)에 대해 직접 정규식 가림 vs 미검토 원문 AI vs SafeHandoff 파이프라인을 결정적으로 비교 측정 |

---

## 2. 빠른 시작 (Quick Start)

### 2.1 빌드 및 전체 품질 검증

```sh
pnpm build
pnpm typecheck
pnpm test
python tools/validate_docs.py
```

### 2.2 실제 서버와 클라이언트 실행

`.env` 파일 또는 환경 변수로 OpenAI 호환 모델 정보를 설정한다 (`SAFEHANDOFF_LLM_BASE_URL`, `SAFEHANDOFF_LLM_MODEL`, 선택적 `SAFEHANDOFF_LLM_API_KEY`).

```sh
# 터미널 1 - 실제 서버 (:8080)
just app

# 터미널 2 - 웹 클라이언트 (:5173 -> :8080 프록시)
just client
```

모델 서버가 없는 환경에서 UI 흐름만 먼저 확인할 때는 연출용 서버를 사용한다.

```sh
# 터미널 1 - 연출용 서버 (:8081)
just fake-app

# 터미널 2 - 연출용 서버에 연결된 웹 클라이언트 (:5174 -> :8081 프록시)
just client-fake
```

### 2.3 ToyRecord 스킬 팩 등록 및 Docker 재현 종단간 시연

```sh
# 1. 로컬 카탈로그에 toyrecord-repro 1.0.0 팩 지문 검증/등록
node tools/pack-register.mjs \
  --root fixtures/skills/toyrecord-repro \
  --allowlist fixtures/skills/toyrecord-allowlist.json \
  --catalog .local/toyrecord-catalog.json

# 2. 합성 입력 생성 + Docker 4회 재현 + 승인팩 작성/검토 스모크 (고정 모델 fixture 모드)
SAFEHANDOFF_TRANSCRIPT_DIR=.local/transcripts SAFEHANDOFF_TRANSCRIPT_CONTENT=1 \
  node tools/oss-repro-smoke.mjs \
  --catalog .local/toyrecord-catalog.json \
  --pack-version 1.0.0 \
  --registration .local/toyrecord-installation.json \
  --seed 42 \
  --output .local/toyrecord-pack-smoke-42.json
```

실제 사내/외부 등록 모델을 호출할 때는 `--live-model` 플래그를 추가한다.

---

## 3. 3대 핵심 시연 시나리오

### 시나리오 1 - 일반 내부 자료로 외부 운영 자문 요청 (`UJ-03`, 표현 수준 A / B / C / D)

1. **원자료**: `fixtures/reference-pack/author/internal-operations/` (`820 / 1,160 / 1,740` 요청량 CSV, 수동 대조/기존 채널 유지 제약이 적힌 운영 메모).
2. **시연 포인트**:
   - **A. 구체적인 데이터 없이 사실만**: 숫자/관찰 횟수 없이 `관찰된 구간에서 요청량이 증가했습니다.`만 승인팩에 들어간다.
   - **B. 추이만 보이게 나머지 마스킹**: `derive_series_v1`(`series_direction_only.v1`)이 `첫 번째: 기준 / 두 번째: 증가 / 세 번째: 증가` 표를 생성한다.
   - **D. 기타 (직접 입력)**: 첫 관찰을 100으로 둔 상대지수(`series_index_base100.v1`)를 적용하면 `100 / 141 / 212`가 결정적으로 계산된다.
   - **다음 달 자료(`820 / 780 / 1,740`)에 기준 재사용**: 과거 문장을 복사하지 않고 새 입력에서 `기준 / 감소 / 증가`를 다시 계산한다.

### 시나리오 2 - 재현 환경이 없는 B2B 기술지원 문의 (`UJ-02`, 사실과 미확인 분리)

1. **원자료**: `fixtures/reference-pack/author/b2b-timeout/` (클라이언트 타임아웃 후 재시도 성공 로그, 내부 사업 메모).
2. **시연 포인트**:
   - `RealCore.analyze()`와 승인팩은 **클라이언트 타임아웃 관찰**과 **최초 요청의 서버 처리/중복 여부 미확인(`unknown`)**을 분리한다.
   - 작성 모델이 "첫 요청이 실패했다"고 단정하면 `Reviewer`가 `UNSUPPORTED_CAUSAL_CLAIM` 또는 `UNCERTAINTY_REMOVED`로 반려하고 승인된 사실만으로 수리한다.
   - 재현 환경이 없어도(`not_run / no_environment`) 관찰 사실과 공급사 확인 요청 질문으로 완결된 문의문을 만든다.

### 시나리오 3 - 오픈소스 버그 제보와 합성 입력 Docker 재현 (`UJ-01`, `toyrecord`)

1. **원자료**: `fixtures/reference-pack/author/oss-encoding/` (7글자 고객 문자열 `한글테스트값A`에서 `E_ENCODE_SHORT_BUFFER`가 발생한 로그와 비밀 토큰 `DEMO_ONLY_SECRET_TOKEN_01`).
2. **시연 포인트**:
   - 고객 문자열(7글자)과 내부 경로(`/srv/labelapp-prod/...`), 비밀 토큰은 제외한다.
   - `make_synthetic_inputs_v1`이 시드 기반으로 원래 문자열과 무관한 6글자 새 입력(`ABCDEF`, `가나다라마바` 등)을 생성한다.
   - `DockerReproRunner`가 `--network=none` 컨테이너에서 buggy/fixed x ASCII/한글 4회 실행을 수행해 `reproduced`를 확인하고, 승인팩에 정형 결과만 투영해 제보문을 완성한다.

---

## 4. 최신 fake-app 기반 CDP 연출 및 제출 영상 검증

- **실행 명령**: `mise exec -- just demo` (탐색/재생 검증: `just demo-check`, macOS MP4 녹화: `just demo-record`).
- **동작 범위**: [진행 코드](../scripts/demo/run.mjs)가 최신 `fake-app`을 별도 SQLite DB/루프백 포트로 실행하고 전용 [연출 화면](../packages/fake-app/public/presentation.html)(`/__presentation`)을 연다. [자막](../scripts/demo/stage.mjs)/[장면 정의](../scripts/demo/scenes.mjs)/[재생 제어](../scripts/demo/playback.mjs)가 6단계/21개 세부 장면과 일시정지/탐색을 제공한다. 분석/공개 선택은 브라우저 연출 상태이며 문서 생성/저장/조회는 공통 `/api/sharing`/`/api/documents` API를 호출한다.
- **녹화 및 제출 시간 검증**: [녹화 코드](../scripts/demo/recording.mjs)와 [macOS 인코더](../scripts/demo/encode.swift)가 실제 CDP 프레임을 H.264 MP4로 인코딩한다. 최신 `fake-app` 제출 녹화([저장된 영상](demo-media/SafeHandoff-demo.mp4), [미리보기](demo-media/preview.png), [검증 결과](../evaluation/results/cdp-submission-run.json))의 실제 길이는 **99.988초**로 110초 제한을 통과했다.

## 5. 시연 중 실패/질문 대응 기준

- **모델 연결 실패 시**: live 모델 실패를 fixture 응답으로 몰래 대체하지 않는다 (`INV-14`). 오류 원인을 그대로 표시하거나 별도 표시된 fixture 시연 모드로 전환해 설명한다.
- **과거 영상 참고자료 사용 시**: 초기 시제품 녹화 영상(`just preview-demo-video`, [영상 안내](presentation/video/README.md))을 참고로 보여줄 때는 사전 녹화된 시연 영상임을 명시하고 현재 실시간 실행 결과와 구분한다.
