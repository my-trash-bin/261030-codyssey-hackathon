# SafeHandoff

실제 앱과 연출용 가짜 앱을 독립적으로 개발하기 위한 TypeScript·pnpm 작업 공간입니다. 실제 앱은 문서 저장·조회와 승인 facts 기반 작성·검토를 제공합니다. **앱이 설정과 환경 변수로 모델을 주입하며, 모델 설정이 없으면 생성은 실패합니다**. 가짜 앱은 템플릿·응답 지연·실패를 바꿔 흐름을 반복 개선합니다.

## 패키지 경계

| 패키지 | 역할 |
| --- | --- |
| packages/app | 최종 실제 앱: 서버 껍데기와 진짜 코어 조립 |
| packages/fake-app | 연출용 가짜 앱: 가짜 코어·연결 연출·조절 화면 |
| packages/server | 코어 구현을 모르는 공통 HTTP·SQLite 껍데기 |
| packages/core-interface | 공유 요청·응답·오류와 Core 계약 |
| packages/core | 모델 주입 기반 작성·검토 Engine. 가짜 구현을 import하지 않음 |
| packages/model-adapter | 설정 기반 호환 HTTP 모델 클라이언트 |
| packages/sandbox-runner | digest 고정 toy 이미지의 격리 실행과 재현 판정 |
| packages/skill-loader | manifest·파일 경로·digest를 검증하는 F07 파일시스템 로더 |
| packages/fake-core | 연출용 문구와 결과 템플릿 |
| packages/client | 공개 전 확인 작업 화면·내부 메모 보관과 API 프록시 |

의존성 경계는 테스트로 강제합니다. server는 Core 인터페이스에만 의존하며 app과 fake-app이 구현을 주입합니다. 가짜 앱의 연출을 고쳐도 실제 앱이나 진짜 코어를 수정할 필요가 없습니다. 현재 구조는 [architecture](docs/architecture.md), 실제 API는 [api](docs/api.md), 독립 개발 계획은 [plan](docs/plan.md)을 따릅니다.

발표자료에 맞춘 UI 작업은 [UI 구현 기준](docs/UI-구현기준.md)을 따릅니다. 화면·승인 흐름의 설계 기준이며, 기능 구현이나 API 연결 완료를 뜻하지 않습니다.

## UI 작업 화면의 현재 범위

- 전달 조건, 공개 방식 A~D, 공유 초안, 접을 수 있는 내부 근거·검토 영역을 구성했습니다. A~D는 기본 미선택이며 설명만 바꿉니다. 직접 입력 조건은 다른 방식을 살펴보고 돌아와도 현재 화면에서 유지됩니다.
- 디자인은 `design-pick`의 `web-swiss-grid`를 기반으로 합니다. 흰 바탕·검정 글자·12열 그리드·직각·무그림자를 적용하고, 왼쪽 전달 조건·공개 방식, 넓은 가운데 초안, 오른쪽 접이식 근거로 구분합니다. 내부 메모와 상세 실행 정보는 작업 영역 뒤에 둡니다.
- 작업 도구에 맞춰 팩의 홍보용 대형 제목·큰 섹션 간격은 줄였습니다. 외부 웹폰트 대신 시스템 글꼴을 사용해 기존 CSP와 외부 자산 미호출 경계를 유지합니다. 미연결 사유는 동작 가까이에 짧게 표시하고 개발용 예시 모드는 항상 보입니다.
- 실제 연결은 `GET /api/core`와 `GET/POST /api/documents`입니다. 내부 메모 저장·조회는 공개 승인이나 공유 초안 생성과 별개입니다. 목적·수신처·직접 입력 조건은 서버에 저장하지 않습니다.
- 파일 첨부, 공개 미리보기 계산·결정 저장, 분석, 공유 초안 생성, 최종 파일 확인·다운로드, 스킬 등록은 서버 API가 없어 비활성 상태와 이유를 표시합니다. `/api/sharing`도 이 화면에서 호출하지 않습니다. 전체 UI 기준의 종단간 구현 완료가 아닙니다.
- 저장·목록 조회 실패 시 입력과 이전 목록을 보존하고, 저장 전 조회가 진행 중이면 끝난 뒤 저장 이후 목록을 다시 조회합니다. 저장 후 목록 갱신까지 중복 저장을 막습니다.
- 확인: 동작 코드의 타입 검사와 기존 통합 검사 2개는 앞선 구현에서 통과했습니다. 이번 디자인 변경은 HTML·CSS만 대상으로 하며, 새 화면에서 실제 메모 저장·재조회·새로고침 지속, 입력 보존, 키보드 이동과 접이식 영역을 확인했습니다. 320px부터 데스크톱까지 가로 넘침이 없었고 접근성 자동 검사 위반은 0건입니다. 실제 모델·전체 승인 흐름·스크린리더 실기는 확인하지 않았습니다.
- 작성 방식: 화면 구조·스타일 초안과 초기 동작을 먼저 만들고, 기준 대조·통합·문서·브라우저 검증으로 나눠 진행했습니다.

## 준비

Node 24.21.0·pnpm 10.13.1·just 1.58.0·Python 3.13.8을 mise로 고정합니다. mise만 먼저 설치하면 just를 포함한 도구는 `mise install`로 준비할 수 있습니다.

```bash
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
cp .env.example .env  # 기존 파일이 있으면 생략
```

## 실제 앱과 가짜 앱 실행

```bash
just app          # 실제 앱 API :8080
just fake-app     # 연출용 앱 :8081, 별도 터미널
just client       # 실제 앱 대상 작업 화면·내부 메모 보관 :5173
just fake-client  # 가짜 앱 대상 같은 화면 :5174
```

연출 조절 화면은 **http://127.0.0.1:8081/__demo**입니다. 제목·도입·마무리, 지연, 실패 횟수를 적용하고 승인한 표현으로 재생성해 볼 수 있습니다. 가짜 앱은 실제 모델을 호출하지 않습니다. 실제 앱의 같은 재생성 API는 설정한 모델로 작성·검토하며 실패 시 503 CORE_UNAVAILABLE를 반환합니다.

기본 수신 주소는 0.0.0.0이며 사내 IP에서도 같은 포트로 접속합니다. 각 터미널의 Ctrl-C로 종료합니다. 현재는 단일 사용자 개발용이며 사내 인증은 미구현입니다. 패키지 dev/start는 루트 .env를 자동으로 읽고 기존 환경 변수가 우선합니다.

실제 앱 DB는 `.local/data/safehandoff.sqlite`, 가짜 앱은 `.local/data/demo.sqlite`이며 각각 DATABASE_PATH와 DEMO_DATABASE_PATH로 지정합니다. 상대 경로 기준은 저장소 루트입니다. 가짜 연출 설정은 메모리에서 관리하며 재시작하면 초기화합니다.

## 검사와 빌드

```bash
just check
pnpm test
pnpm typecheck
pnpm build
```

just check는 QG를 직접 실행합니다. QG가 recommended 규칙과 공식 @slop-lab/qg-rules-js의 js preset, 타입·빌드·Node 테스트를 호출합니다. pnpm test에서 QG 전체 검사를 다시 호출하지 않습니다. 한국어 문서·파일명을 허용합니다. 실제 모델 호출은 일반 검사에 포함하지 않습니다.

빌드된 앱은 `pnpm --filter @safehandoff/app start`, 가짜 앱은 `pnpm --filter @safehandoff/fake-app start`로 각각 실행합니다. 진짜 코어는 packages/core에서 공통 계약을 구현하면서 독립 시험합니다.

intent.md·제품 설계·contracts·fixtures/demo·과거 evaluation 기록은 보존합니다. 제품 전체 기능의 구현 완료와 시연 템플릿 동작을 구분합니다.

## 코어 라이브러리의 현재 범위

`RealCore(modelClient, engineConfig, reproRunner?)`에 설정과 모델을 주입하면 `write`·`review`를 사용할 수 있습니다. `writeReviewed`는 단계별 재시도, 전체 모델 호출 수, 검토 수정 횟수 상한을 함께 지킵니다. `generate`는 기존 승인 facts 계약으로 작성·검토 한 번만 수행하며 검토 실패 시 문서를 반환하지 않습니다.

`OpenAICompatibleModelClient(providerConfig, env?)`는 설정에 지정한 환경 변수 이름으로 URL·모델·키를 조회합니다. 환경 변수는 아래 연결 표를 따릅니다. 한 complete 호출은 HTTP 요청 한 번이며 재시도는 Engine이 담당합니다. HTTP 테스트는 로컬 목 서버만 사용합니다.

분석·공개 제안·미리보기 계산과 task/decision HTTP API는 미구현입니다. Docker 실행기와 내부 task/decision 저장은 [3라운드 범위](docs/round3-scope.md)로 구현했습니다. `composeFactPack`은 서버가 범위·원자료·hash를 검증한 현재 결정과 미리보기를 입력받는 순수 변환이며 승인 저장을 대신하지 않습니다.

## 모델·실행기 환경 변수

`.env.example`의 기존 서버·클라이언트·가짜 앱 변수는 모두 현재 코드에서 사용합니다. 아래 변수를 추가했으며 `.env`의 기존 비공개 값은 그대로 사용합니다.

| 변수 | 용도 |
| --- | --- |
| SAFEHANDOFF_LLM_BASE_URL | 호환 모델의 기본 URL. 앱이 `/chat/completions`를 붙임 |
| SAFEHANDOFF_LLM_MODEL | 요청 모델 ID |
| SAFEHANDOFF_LLM_API_KEY | Authorization Bearer 키. 로그·컨테이너에 전달하지 않음 |
| SAFEHANDOFF_CONFIG | 선택 설정 파일 경로. 생략하면 config.json, 없으면 config.example.json |
| SAFEHANDOFF_REPRO_REGISTRY | 선택 Docker 등록 파일 경로. reproduction.enabled=true일 때 사용 |

상대 설정 경로는 저장소 루트 기준입니다. 모델 세 변수가 모두 있어야 ready=true이며 이는 서버 응답이나 의미 정확성을 확인했다는 뜻은 아닙니다. 시작 시 모델을 호출하지 않습니다. TLS가 기본이며 HTTP 예외·기능·호출 제한은 설정 파일의 provider 블록으로 지정합니다. response_mode=text인 서버에는 response_format을 보내지 않고, JSON 출력은 프롬프트와 응답 검증으로 요구합니다. config.json과 .env는 커밋하지 않습니다.

내부 `TaskStore`는 기존 SQLite 파일에 별도 workflow 테이블을 추가합니다. 현재는 앱 HTTP 경로와 연결하지 않았으며 자동으로 문서나 원자료를 작업으로 옮기지 않습니다. Docker 설치·등록·검증 절차는 [실행기 안내](packages/sandbox-runner/image/README.md)를 따릅니다.

F07 1번의 파일시스템 로더는 [사용법과 제한](packages/skill-loader/README.md)을 따릅니다. 등록 CLI와 ToyRecord catalog 연결은 구현했습니다. 역할별 프롬프트 연결·앱의 팩 선택 및 변경 무효화는 후속이며 앱 시작 시 팩을 자동으로 읽거나 실행하지 않습니다.

## builtin과 근거 검토

core의 `createBuiltinTools`는 현재 task/revision과 서버가 검증한 grant·인수 SHA-256을 받아 builtin 5개를 만든다. 순수 변환은 승인이나 도구 권한을 새로 만들지 않는다. 시간·입력 길이·원문 인용·정확값 공개는 승인된 인수에 묶는다.

`review(draft, pack, grounding)`와 `writeReviewed(pack, { grounding })`에는 현재 결정·미리보기·scope·원자료 집합·규칙 판본의 effective snapshot이 필요하다. 없거나 유효하지 않으면 모델 호출 전에 needs_decision이다. 기존 `/api/sharing`의 승인 facts 입력은 그 요청의 새 승인으로만 연결하며, F06 Rule 저장·자동 매칭·승인 UI는 구현하지 않았다. 상세 계약은 [grounding 계획과 구현 상태](docs/review-grounding-plan.md)를 따른다.

OSS 가상 재현은 빌드 후 아래 명령으로 실행한다. 등록 파일에는 설치자가 확인한 현재 `/repro` supervisor 이미지의 전체 image ID가 있어야 한다. legacy 이미지 tag/digest가 존재하는 것만으로 호환된다고 가정하지 않는다.

```bash
node --env-file-if-exists=.env tools/oss-repro-smoke.mjs \
  --registration .local/oss-smoke-registration.json --live-model \
  --output .local/oss-repro-smoke-new.json
```

--live-model을 생략하면 모델은 fixture이고 Docker는 실제 실행한다. 자동 테스트에서는 fake runner 주입을 명시적으로 표시한다. 실행 중 pull/build는 하지 않는다. 새 결과 파일만 쓰며 기존 결과를 덮어쓰지 않는다. 원자료 분석·승인은 fixture 가정이고 실제 구현한 분석·승인 제품 흐름으로 표시하지 않는다. 전체 호스트의 인터넷 차단이나 실제 OSS 결함 발견을 검증한 시험도 아니다.

OSS 스모크의 자동 회귀 검사는 실행 행·고정 oracle·수치·hash·참조·정책 상태만 판정합니다. 생성 문장 의미를 정규식으로 통과시키지 않습니다. 보고서의 execution_summary가 실제 실행 수치이며, 문서는 reviewed_draft_not_finalized와 manual_review_required=true로 표시합니다. 모델 pass는 사람의 최종 확인을 대신하지 않습니다.

실행 transcript는 `SAFEHANDOFF_TRANSCRIPT_DIR=.local/transcripts`로 켠다. 기본은 단계 메타데이터이며 `SAFEHANDOFF_TRANSCRIPT_CONTENT=1`을 함께 설정하면 승인된 모델 입력과 작성 초안도 기록한다. HTTP 응답은 바뀌지 않는다. 데모 연결 형식·권한·보존 제한은 [transcript 문서](docs/transcript.md)를 참고한다.

ToyRecord 팩을 실제 catalog에서 선택해 OSS 스모크로 연결할 수 있다. `--catalog`, `--pack-version`, 운영자 `--registration`을 함께 사용하며 실행 전에 digest를 재검증한다. [설치·실행 절차](docs/toyrecord-pack.md)를 따른다.


발표자료는 최초 `mise run setup-presentation` 후 `mise exec -- just build-presentation`으로 통합
HTML·PDF를 생성한다. 개별 슬라이드 HTML은 편집용이며 생성 대상이 아니다. PDF는 로컬 산출물로
Git에서 제외한다. Chromium 시스템 라이브러리 설치와 상세 절차는 [발표 빌드 안내](docs/presentation/README.md)를 따른다.

이전 CDP fixture 녹화와 연출 코드 참고자료는 [영상 안내](docs/presentation/video/README.md)를
따른다. `mise exec -- just preview-demo-video`로 원본 hash를 검증한 과거 영상을 로컬에서 확인한다.
