# SafeHandoff

사내 자료에서 **사용자가 허용한 정보만 모아 새 외부 공유 문서를 만드는** 로컬 PoC입니다. 공개 선택을 바꾸면 이전 본문·첨부·ZIP을 함께 무효화하고, 현재 판본에서 검토한 실제 파일만 확정·다운로드합니다. 자동 메일·외부 제출 기능은 없습니다.

현재 구현은 Go 단일 서버, SQLite, 서버 HTML과 ES modules입니다. 도구 버전은 사용자 요청에 따라 **mise**로 관리합니다. 사내 모델이 없어도 개발용 fixture 모드로 실행합니다. fixture의 고정 검토 응답은 실제 모델의 의미 검토 성능을 증명하지 않습니다. 명세 대비 구현 선택·제한과 실제 미수행 검증은 [검증 보고서](docs/검증보고서.md)에 구분했습니다.

## 실행

준비물은 Linux/macOS 호환 Go 실행 환경과 [mise](https://mise.jdx.dev/)입니다. Docker는 합성 재현·외부 checker 시험에만 필요합니다.

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

## 구조와 계약

- [구조도·설계 결정](docs/구조와설계.md): 패키지 책임, 데이터·역할·파일 경계, 저장 구조
- [API 사용 안내](docs/API와역할계약.md), [OpenAPI 3.1](contracts/openapi.json), [JSON Schema](contracts)
- [시연 순서](docs/시연안내.md), [검증 결과·제한](docs/검증보고서.md)
- [실제 fixture 보고서](evaluation/results/fixture-run.json), [Docker 확장 보고서](evaluation/results/extensions-run.json), [live 미수행 보고서](evaluation/results/live-run.json)

Go **1.27.3**, modernc.org/sqlite **v1.61.0**, GNU Make **4.4.1**을 고정했습니다. Go 및 드라이버는 [공식 배포 목록](https://go.dev/dl/)과 [버전 문서](https://pkg.go.dev/modernc.org/sqlite@v1.61.0)를 확인하고 실제 빌드했습니다. 런타임 웹 자원·한국어 글꼴은 실행 파일에 포함되며 CDN을 사용하지 않습니다. Noto Sans KR의 [OFL 라이선스](web/static/NotoSansKR-OFL.txt)를 포함합니다.
