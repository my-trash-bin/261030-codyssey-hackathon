# SafeHandoff

사내 자료에서 **사용자가 허용한 정보만 모아 새 외부 공유 문서를 만드는** 로컬 PoC입니다. 공개 선택을 바꾸면 이전 본문·첨부·ZIP을 함께 무효화하고, 현재 판본에서 검토한 실제 파일만 확정·다운로드합니다. 자동 메일·외부 제출 기능은 없습니다.

현재 구현은 Go 단일 서버, SQLite, 서버 HTML과 ES modules입니다. 도구 버전은 사용자 요청에 따라 **mise**로 관리합니다. 사내 모델이 없어도 개발용 fixture 모드로 실행합니다. fixture의 고정 검토 응답은 실제 모델의 의미 검토 성능을 증명하지 않습니다. 명세 대비 구현 선택·제한과 실제 미수행 검증은 [검증 보고서](docs/검증보고서.md)에 구분했습니다.

## 구현 기준 문서

구현 문서 묶음 v1.0을 저장소 루트 구조에 반영했습니다. [프로젝트 의도](intent.md), [작업 규칙](AGENTS.md), [PRD](docs/prd.md), [공통 명세](docs/spec.md), [기능별 명세](docs/features/01-task-intake.md)를 참고하세요. 현재 구현과의 차이는 [검증보고서](docs/검증보고서.md#구현-문서-묶음-v10-반영)에 기록했습니다.

SQL·schema·평가 틀은 설계 참조이며 런타임에는 아직 적용하지 않았습니다. 새 문서용 가상 자료는 기존 실행용 자료와 구분해 `fixtures/reference-pack/`에 보관합니다. 기존 T01–T28과 새 QA T01–T60의 결과는 번호만으로 이전하지 않습니다.

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

---

## 제공된 구현 문서 묶음 안내

아래 안내는 설계 패키지 자체의 구성과 예정된 구현 범위를 설명합니다. 현재 실행 가능한 앱의 상태는 위 실행 안내와 검증보고서를 따릅니다.

# SafeHandoff · 구현 시작 문서 묶음

버전 1.0 · 2026-10-31 · **설계·계약·가상 예시 자료**. 이 패키지에는 완성된 앱이 들어 있지 않으며 제품 인수시험 결과는 아직 없다.

## 무엇을 만드는가

회사 자료를 외부에 공유하기 전에, 목적에 필요한 자료를 준비하는 사람의 수고를 돕는 사내 실행 오픈소스 도구다. 주요 사례는 오픈소스 버그 제보와 B2B 기술지원이다. 일반 내부 자료의 외부 자문에도 같은 흐름을 적용한다.

사용자가 목적·상대·자료를 넣으면 에이전트가 필요한 내용과 공개 수준을 제안한다. 사람이 고른 범위로 새 문서·표·예제를 작성하고, 작성 중 검토와 추가 질문을 반복한다. 최종 파일은 사용자가 확인해 복사·저장한다. 준비된 실행 환경이 있으면 새 합성 예제의 재현 결과도 확인한다.

목표는 ‘같은 공개 조건과 수신자 효용을 만족하는 자료를 준비할 때 사람 작업량이 줄어드는가’다. 완전한 유출 방지·항상 성공하는 재현·미측정 시간 절감률은 약속하지 않는다. 원문을 처리하는 환경과 모델은 회사 내부에 두며 여러 회사의 원문을 모으는 중앙 SaaS를 전제로 하지 않는다.

## 바로 시작하는 순서

1. 팀 전체가 [프로젝트 의도](intent.md)와 [작업 규칙](AGENTS.md)을 먼저 확인하고 [PRD](docs/prd.md), [spec](docs/spec.md), [결정 기록](docs/decisions.md)을 읽는다.
2. [작업 계획](docs/plan.md)에서 맡을 기능과 다른 기능의 연결 상대를 정한다.
3. 맡은 [기능 명세](#기능-명세)를 읽고 화면·API·데이터·AC를 대조한다.
4. 필요한 변경은 기능 파일과 공통 PRD/spec/API/ERD를 함께 수정한 문서 PR로 검토한다.
5. 경계 계약이 맞으면 구현한다. [구현 에이전트 시작 지시](docs/implementation-start.md)를 그대로 전달해도 된다.
6. 기능별 AC와 [QA](docs/qa.md)를 검증하고 실제 결과를 [보고 틀](evaluation/results/report-template.json)에 남긴다.

이 패키지에 기록되지 않은 실제 사내 endpoint·권한·보존 정책은 추정하지 않는다. 반면 작은 구현 선택을 모두 질문으로 남기지 않도록 PoC 기본값을 정해 두었다.

## 문서 지도

| 문서 | 답하는 질문 |
| --- | --- |
| [intent.md](intent.md) | 프로젝트의 목적·가치·핵심 경계는 무엇이며 무엇이 명시 승인 대상인가? |
| [AGENTS.md](AGENTS.md) | 파일들의 역할·권위·변경 관계와 작업 권한은 무엇인가? |
| [prd.md](docs/prd.md) | 누구의 어떤 일을 줄이며 어디까지 만들까? |
| [spec.md](docs/spec.md) | 같은 입력·선택·실패에서 정확히 어떻게 동작해야 할까? |
| [ERD.md](docs/ERD.md) | 무엇을 저장하고 어떤 관계·판본·삭제 규칙을 지킬까? |
| [IA.md](docs/IA.md) | 화면·URL·버튼·빈/실패 상태는 어디에 있을까? |
| [uj.md](docs/uj.md) | OSS·B2B·일반자료 사용자는 어떻게 완성하고 복구할까? |
| [api.md](docs/api.md) | 기능들이 어떤 요청·응답·함수로 연결될까? |
| [architecture.md](docs/architecture.md) | 프로세스·모듈·모델 어댑터·설정은 어떻게 나눌까? |
| [agent-workflow.md](docs/agent-workflow.md) | 분석·작성·검토가 무엇을 읽고 어떤 구조로 답할까? |
| [security.md](docs/security.md) | 사내 실행·권한·통신·원문·최종 파일의 경계는 어디인가? |
| [extensions.md](docs/extensions.md) | 라이브러리 지침·맥락 예외·재현 실행을 어떻게 붙일까? |
| [plan.md](docs/plan.md) | 어떤 순서·역할·계약으로 나눠 구현할까? |
| [qa.md](docs/qa.md) | 정상·경계·오류·권한·실제 효용을 어떻게 판정할까? |
| [test-data.md](docs/test-data.md) | 가상 입력·기대 결과·변형·수신자 자료는 무엇인가? |
| [demo.md](docs/demo.md) | 팀에게 어떤 사례와 실패 경로를 보여줄까? |
| [decisions.md](docs/decisions.md) | 사용자 확정·새 기본 설계·실제 확인 필요는 무엇인가? |
| [implementation-start.md](docs/implementation-start.md) | 구현 에이전트에게 어떤 작업 지시를 줄까? |
| [traceability.csv](docs/traceability.csv), [acceptance-map.csv](docs/acceptance-map.csv) | 요구·기능·인수 조건·시험은 어떻게 연결되는가? |

## 기능 명세

| ID | 담당 조각 | 개발 단계 |
| --- | --- | --- |
| [F01](docs/features/01-task-intake.md) | 목적·상대·원자료 입력 | P0 |
| [F02](docs/features/02-evidence-analysis.md) | 근거 추출·공개 후보 제안 | P0 |
| [F03](docs/features/03-disclosure-decisions.md) | 공개 수준·직접 입력·원문/정확값 결정 | P0 |
| [F04](docs/features/04-compose-review.md) | 새 작성·작성 중 검토·수동 복구 | P0 |
| [F05](docs/features/05-export.md) | 실제 파일 확인·확정·복사/다운로드 | P0 |
| [F06](docs/features/06-decision-reuse.md) | 조건별 표현 기준 저장·재적용·철회 | P0 |
| [F07](docs/features/07-domain-extensions.md) | 제품 지침·맥락 예외·등록 도구 | P1 |
| [F08](docs/features/08-reproduction.md) | 합성 입력·고정 대상 재현 | P1 |
| [F09](docs/features/09-history-recovery.md) | 진행·이력·충돌·복구·삭제 | P0 |
| [F10](docs/features/10-runtime-boundary.md) | 로컬 접속·내부 모델·실행 경계 | P0 |

모든 기능 파일에 목적, 사용자/권한, 화면, 데이터, 규칙, 연동, 하지 않을 것, 완료 기준, 확인 필요를 채웠다. 추가 기능용 [템플릿](docs/features/00-template.md)도 제공한다.

P1은 이번 PoC 설계에서 빠진 항목이 아니라 core 다음의 예정된 확장 검증이다. P0만 끝났으면 core 완료라고 보고한다. 자동 제출·OCR·다중 사용자·외부 SaaS·임의 스크립트·모델 최적화는 P2다.

## 기계 판독 계약과 예시 자료

- [domain-contract.json](contracts/domain-contract.json): enum, 범위 일치 조건, 기본 한도, 변환, 목적별 필수 정보.
- [core.schema.json](contracts/core.schema.json): 핵심 요청·분석/초안 응답의 JSON Schema 정의. 도메인 권한·hash 검사는 별도 필수다.
- [schema.sql](contracts/schema.sql): 24개 테이블의 초기 migration 참조. DDL과 서비스 규칙의 경계는 ERD에 명시했다.
- [catalog.example.json](contracts/catalog.example.json): 가상 프로젝트·상대·팩·선택의 시작 카탈로그.
- [fixtures/reference-pack/author](fixtures/reference-pack/author/README.md): 작성자에게 주는 OSS·B2B·일반 자료.
- [fixtures/reference-pack/public/toyrecord](fixtures/reference-pack/public/toyrecord/README.md): 공개 toy 입력 계약과 테스트 입력. 실제 결함/수정 코드·runner는 구현 대상이다.
- [fixtures/reference-pack/recipient](fixtures/reference-pack/recipient/README.md): 공급사 역할에게만 줄 기록. 앱에 제공하지 않는다.
- [evaluation/expected](evaluation/expected/oss-baseline.json): 평가자용 기대 조건. 앱/모델/도구가 읽을 수 없다.

모든 예시 회사·제품·개인·토큰은 가상이다. fixture provider 결과, 실제 사내 모델 결과, 사람이 완성한 결과, 실제 runner 결과를 구분한다.

## 팀이 지켜야 할 공통 결정

Go 단일 앱·SQLite·서버 HTML/순수 JS, 단일 로컬 사용자, 이미 있는 사내 LLM으로 시작한다. 이는 이전 구현안을 이어 구체화한 기본 설계이며 모델·하드웨어 조건은 없다.

공개 선택과 최종 파일 확인은 별도다. 작성 중 선택을 바꾸면 이전 결과를 무효화한다. 새 정확값·원문은 이전 허용을 재사용하지 않는다. 재현이 안 되면 관찰 자료로 문의를 완성할 수 있지만, 재현 증거를 목표로 선택했다면 사용자가 목표를 명시적으로 바꿔야 한다.

문서 사이에 충돌이 보이면 기능 파일 안에서만 우회하지 않는다. 최신 사용자 결정→프로젝트 의도(intent)→제품 범위(PRD)→공통 동작(spec)→데이터/API/contracts→기능 명세 순으로 원인을 확인하고 관련 문서를 함께 수정한다. 실제 정책이나 사용자 의도를 새로 추측해야 하는 경우는 Q로 기록한다.

## 지금 확인이 필요한 것은 무엇인가

실제 사내 모델 연결·인증·보관 정책(Q-LLM), 조직 공유 권한·보존 정책(Q-POLICY), 실제 제품·라이브러리 확장 대상(Q-EXT), 내부 배포·망차단 방식(Q-DEPLOY), 팀 역할(Q-TEAM), 공개 라이선스(Q-LICENSE)다. 가상 자료와 fixture로 개발을 시작하는 데는 이 답을 기다릴 필요가 없다. 실자료 처리·live 검증·실제 공개 배포 전에 해당 항목을 채운다.

## 이 묶음의 검증 범위

문서 링크·ID 연결·가상 JSON/CSV·초기 SQL 구조를 검사한다. 재실행은 `python3 tools/validate_docs.py`이며 Python 표준 라이브러리만 사용한다. 결과 기록은 [문서 검증 기록](validation-report.json)에 남긴다. 문서 검증 통과를 제품 코드·모델 품질·격리·성능·실제 사용자 효과의 검증으로 바꾸어 말하지 않는다.
