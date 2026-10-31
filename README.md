# SafeHandoff

회사 자료를 외부에 공유하기 전에 **목적에 필요한 자료를 준비하는 수고를 줄이는** 사내 실행 오픈소스 PoC입니다. 사용자가 허용한 정보로 문의문·표·예제를 새로 작성합니다. 공개 선택을 바꾸면 이전 본문·첨부·ZIP을 함께 무효화하고, 현재 판본에서 검토한 실제 파일만 확정·다운로드합니다. 자동 메일·외부 제출 기능은 없습니다.

현재 구현은 Go 단일 서버, SQLite, 서버 HTML과 ES modules입니다. 도구 버전은 사용자 요청에 따라 **mise**로 관리합니다. 사내 모델이 없어도 개발용 fixture 모드로 실행합니다. fixture의 고정 검토 응답은 실제 모델의 의미 검토 성능을 증명하지 않습니다. 명세 대비 구현 선택·제한과 실제 미수행 검증은 [검증 보고서](docs/검증보고서.md)에 구분했습니다.

## 구현 기준과 문서 안내

문서 기준은 v1.0(2026-10-31)입니다. [프로젝트 의도](intent.md) → [작업 규칙](AGENTS.md) → [PRD](docs/prd.md) → [공통 명세](docs/spec.md) → API·ERD·기능 명세 순으로 읽습니다. 아래 실행 안내는 현재 코드에서 확인한 방법이며, 명세의 모든 기능이 구현됐다는 뜻은 아닙니다.

| 문서 | 용도 |
| --- | --- |
| [PRD](docs/prd.md), [공통 명세](docs/spec.md) | 제품 범위, 목표별 완료 조건, 상태·공개 결정 |
| [API](docs/api.md), [역할 입출력](docs/agent-workflow.md) | 요청·응답·모델 역할의 기준 계약 |
| [구조](docs/architecture.md), [ERD](docs/ERD.md), [보안](docs/security.md) | 모듈·저장·접속·보존·실행 경계 |
| [화면](docs/IA.md), [사용자 여정](docs/uj.md) | 화면 경로와 정상·실패·복구 흐름 |
| [기능 F01–F10](docs/features/01-task-intake.md), [구현 계획](docs/plan.md) | 기능별 인수 조건과 통합 순서 |
| [QA](docs/qa.md), [AC 대응](docs/acceptance-map.csv), [시험 추적](docs/traceability.csv) | AC 127개·QA T01–T60의 연결 |
| [테스트 자료](docs/test-data.md), [시연](docs/demo.md) | 가상 입력과 목표 시나리오 |
| [설계 결정](docs/decisions.md), [구현 시작 지시](docs/implementation-start.md) | 기본값·확인 필요·구현 절차 |
| [검증보고서](docs/검증보고서.md) | 현재 구현·시험 결과·미완료 사항 |

공통 계약은 [domain-contract.json](contracts/domain-contract.json), [core.schema.json](contracts/core.schema.json), [참조 DDL](contracts/schema.sql), [카탈로그 예시](contracts/catalog.example.json)를 따릅니다. core schema는 [공통·요청·모델 모듈](contracts/core/README.md)을 로컬 등록해 사용하며 기존 schema ID와 정의 이름을 유지합니다. 24개 참조 테이블과 새 API 계약은 아직 런타임에 적용되지 않았습니다. `contracts/openapi.json`과 개별 `*.v1.schema.json`은 기존 코드에서 생성한 산출물이며 새 기준과 다른 부분은 구현 전환 대상입니다.

P0는 입력·분석·선택·작성/검토·확정·재사용·복구·실행 경계, P1은 제품 팩·맥락 검사·재현 확장입니다. core fixture 동작, 실제 모델 검증, 확장 검증, 전체 PoC 완료를 구분합니다. 실제 모델·수신자 평가와 작업량 비교는 아직 미수행입니다.

새 기준의 가상 자료는 `fixtures/reference-pack/`, 현재 코드의 시험 자료는 `fixtures/author/`입니다. 평가자 기대 조건과 수신자 전용 자료를 앱·모델에 제공하지 않습니다. 새 QA 결과는 `not_run`이며 기존 T01–T28의 결과를 번호로 이전하지 않습니다.

## 실행

개발·검증 도구는 [mise](https://mise.jdx.dev/)로 관리하는 Go·Make·Node.js 24.21.0입니다. `make setup`이 고정 npm 개발 의존성도 설치합니다. 앱 실행 자체에는 Node/npm이 필요하지 않으며 Docker는 합성 재현·외부 checker 시험에 사용합니다.

```bash
mise trust
mise install
mise exec -- make setup
mise exec -- make test
mise exec -- make run-fixture
```

브라우저에서 **http://127.0.0.1:8080** 을 엽니다. 처음에는 작업 기록이 비어 있습니다. 새 작업을 만들고 `fixtures/author/b2b-timeout`의 세 파일을 업로드합니다. 자료 분석 후 공개 미리보기를 확인하고 선택을 적용한 뒤 작성 → 최종 파일 확인 → 이 파일들로 확정 순으로 진행합니다.

실제 확인한 출력 예:

```text
ok  safehandoff.local/poc/internal/httpapi
ok  safehandoff.local/poc/internal/policy
SafeHandoff fixture: http://127.0.0.1:8080
```

fixture DB는 `var/fixture`, 일반 live DB는 `var/safehandoff`에 분리됩니다. 실행 중인 다른 서버가 있으면 `./bin/safehandoff --fixture --data-dir ./var/demo --listen 127.0.0.1:8081`처럼 포트를 바꿉니다. seed는 `mise exec -- make seed-demo`로 전용 `var/demo`에 **미승인** 작업 세 개를 만듭니다. 이 DB를 보려면 `./bin/safehandoff --fixture --data-dir ./var/demo`로 실행하세요.

## 실제 사내 모델 연결

```bash
cp config.example.json config.json
export SAFEHANDOFF_LLM_BASE_URL=https://your-internal-endpoint/v1
export SAFEHANDOFF_LLM_MODEL=your-internal-model
# 인증이 필요한 경우에만 환경 변수 설정
export SAFEHANDOFF_LLM_API_KEY=...
mise exec -- make run
```

`base_url`은 `/v1`까지의 API root입니다. 모델 서비스가 HTTP만 제공하면 **해당 로컬 설정의** `provider.allow_plain_http`를 `true`로 바꿉니다. redirect는 따라가지 않습니다. 시스템 역할 미지원은 `supports_system_role=false`, temperature 미지원은 `send_temperature=false`, 출력 제한 매개변수는 `max_tokens / max_completion_tokens / omit`으로 설정합니다. 일반 텍스트 JSON 응답만 필요하며 native tool calling은 실행하지 않습니다. live 장애 시 fixture로 자동 전환하지 않습니다.

```bash
mise exec -- make test-live
```

endpoint·모델이 없으면 evaluator가 `not_run`, 종료 코드 2를 남깁니다. 실제 사내 모델 실행 기록은 아직 없습니다. 인증 값을 UI·프롬프트·저장소에 넣지 마세요. `config.json`, `.env`, `var`, `bin`은 Git에서 제외됩니다.

## 재현과 평가

```bash
mise exec -- make prepare-runners
mise exec -- make test-extensions
mise exec -- make eval
```

준비 단계에서만 고정 바이너리와 `scratch` Docker 이미지를 빌드합니다. 실행 단계에서는 이미지 pull·네트워크·코드 생성을 허용하지 않습니다. Docker daemon 권한이 없으면 `not_run/no_environment`입니다. 준비 뒤 코드를 바꾸면 등록 digest를 다시 준비해야 합니다.

`make eval`은 가상 자료에 명시적인 테스트 공개 계획을 적용하고 앱의 확정·다운로드 경로로 실제 ZIP을 검사합니다. 제품 모델에는 평가 정답표가 제공되지 않습니다. 결과는 [evaluation/results](evaluation/results)에 저장됩니다. 각 실행 ID의 `runs/{run_id}` 보고서·trace·파일과 최신 `*-run.json`을 함께 남깁니다. 이전 예시는 `previous-examples`에 보존하며 실패 실행을 지우지 않습니다. `pass`는 자동 검사 범위의 성공이고 사람 의미 평가·수신자 평가는 별도입니다.

공개 결과 예시는 [공급사 문의](evaluation/results/examples/b2b-timeout-direction/support-request.md), [방향 표](evaluation/results/examples/b2b-timeout-direction/observations.csv), [ID 미공개 문의](evaluation/results/examples/b2b-timeout-direction-ids-excluded/support-request.md), [운영 자문](evaluation/results/examples/internal-operations-ratio/operations-brief.md), [OSS 재현 패키지](evaluation/results/examples/oss-encoding-direction)입니다. ZIP과 manifest도 같은 폴더에 있습니다. 모두 가상 자료입니다.

독립 수신자는 A 패키지의 `repro` 폴더에서 다음을 실행할 수 있습니다.

```bash
GOTOOLCHAIN=local GOPROXY=off go run ./cmd/repro --inputs ./inputs
```

입력 생성 변형:

```bash
./bin/safehandoff-fixtures --scenario internal-operations --seed 41 \
  --variation middle-decrease --out ./var/demo-inputs
```

`baseline`, `middle-decrease`, `source-conflict`, `ids-excluded`, `recipient-changed`, `wrong-target`, `checker-error`만 받습니다. 일부 변형은 원자료 변경이며, 나머지는 생성 manifest의 테스트 결정·실행 계획입니다. 자동으로 사용자 승인을 만들지 않습니다.

## 문서와 제품 검증

```bash
mise exec -- make test
# 개별 실행
mise exec -- npm run lint
mise exec -- npm run test:qg
mise exec -- make test-go
mise exec -- make test-docs
```

`make test`와 `npm test`는 `@slop-lab/qg`의 기본 recommended 규칙, QG 정책 회귀시험, Go 단위·통합시험, 문서 검사를 함께 실행합니다. `.qg.yaml`에서 한국어·영어 문서를 허용하고 문서에서 사용하는 기호를 명시했습니다. 한국어 문서를 영어로 바꿀 필요는 없습니다.

생성된 계약·실행 보고서·로컬 빌드 출력은 생성물로 분류합니다. 기존 CSV 행·프롬프트·HTML/JS 템플릿의 긴 줄은 해당 경로에만 유한 한도를 설정했으며 그 밖의 recommended 규칙은 유지합니다. Git hook 자동 설치는 끄고 동일 검사를 npm/Make 진입점으로 실행합니다. 파일 길이는 500줄 초과 경고·1000줄 초과 오류를 유지하며, 기존 경고 파일은 책임별로 분할했습니다.

문서 링크·AC/QA 연결·가상 자료·참조 SQL을 검사합니다. [문서 검사 결과](validation-report.json)는 제품 시험 결과와 별개입니다. 현재 앱의 실행 증거는 [fixture](evaluation/results/fixture-run.json), [확장](evaluation/results/extensions-run.json), [live 미수행](evaluation/results/live-run.json) 및 [검증보고서](docs/검증보고서.md)를 참고하세요.

Go **1.27.3**, modernc.org/sqlite **v1.61.0**, GNU Make **4.4.1**을 고정했습니다. Go 및 드라이버는 [공식 배포 목록](https://go.dev/dl/)과 [버전 문서](https://pkg.go.dev/modernc.org/sqlite@v1.61.0)를 확인하고 실제 빌드했습니다. 런타임 웹 자원·한국어 글꼴은 실행 파일에 포함되며 CDN을 사용하지 않습니다. Noto Sans KR의 [OFL 라이선스](web/static/NotoSansKR-OFL.txt)를 포함합니다.

## CDP 화면 시연

Chrome을 별도 창으로 열어 가상 자료 업로드, 공개 미리보기, 시연용 선택 적용,
초안 작성과 실제 파일 확인을 순서대로 보여줍니다. 큰 자막·강조·커서가 표시되며
화면의 일시정지·재생·이전·다음 버튼으로 제어합니다.
하단에는 각 과정의 의미, 6단계 진행 위치, 세부 장면 번호와 진행률을 표시합니다.
단계 버튼·장면 목록·타임라인으로 원하는 장면을 선택하면 해당 위치에서 멈춥니다.
장면 이동은 새 가상 작업으로 상태를 다시 만들며, 도착 후 재생 버튼으로 계속합니다.
종료 버튼은 시연 창과 서버를 닫습니다.

```bash
mise exec -- make build
mise exec -- npm run demo:cdp
```

macOS Google Chrome을 기본으로 사용합니다. 다른 설치 위치는 `CHROME_PATH`로 지정합니다.
실행마다 별도 Chrome 프로필과 `var/cdp-demo-*` fixture DB를 만들고 loopback 서버를 실행합니다.
최종 확정·다운로드는 직접 수행합니다. 창을 닫거나 터미널에서 Ctrl+C를 누르면 서버도 종료합니다.
자동 검증은 `mise exec -- npm run demo:cdp -- --headless --fast`로 실행합니다.
실제 실행 기록과 마지막 화면은 해당 실행 폴더의 `run.json`, `final.png`에 저장됩니다.
완료 후 화면과 재생 제어는 유지됩니다. 처음으로 버튼이나 장면 선택으로 다시 살펴봅니다.
재생 제어 검증은 위 자동 검증 명령에 `--verify-playback`을 추가합니다.

자동 재생은 제출 제한 110초를 기준으로 장면별 해설·전환 시간을 배정합니다.
정상 속도의 실행 시간은 실행 폴더 `run.json`의 `timing`에서 확인합니다.
일시정지·장면 재탐색·`--fast` 실행은 제출 길이 검증과 구분합니다.

macOS에서 제출용 MP4를 만들려면 다음을 실행합니다. Xcode Command Line Tools의
Swift와 AVFoundation을 사용하며 별도 인코더 다운로드는 없습니다.

```bash
mise exec -- npm run demo:cdp -- --headless --record
```

해당 실행 폴더에 `submission.mp4`와 실제 영상 길이·프레임 검사 결과를 저장합니다.
110초를 초과하면 검사 실패로 종료합니다. 영상은 가상 자료의 실제 CDP 화면 녹화이며
마지막 확정은 자동 실행하지 않습니다.

[제출 영상 MP4](docs/demo-media/SafeHandoff-demo.mp4) · [미리보기](docs/demo-media/preview.png) · [검증 결과](evaluation/results/cdp-submission-run.json)

제출 영상은 가상 자료로 실행한 **1분 43.14초** 녹화본입니다.
