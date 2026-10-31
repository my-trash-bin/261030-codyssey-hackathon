# SafeHandoff

실제 앱과 연출용 가짜 앱을 독립적으로 개발하기 위한 TypeScript·pnpm 작업 공간입니다. 실제 앱은 문서 저장·조회와 코어 호출 경계만 제공하며 **진짜 코어는 아직 미구현**입니다. 가짜 앱은 템플릿·응답 지연·실패를 바꿔 흐름을 반복 개선합니다.

## 패키지 경계

| 패키지 | 역할 |
| --- | --- |
| packages/app | 최종 실제 앱: 서버 껍데기와 진짜 코어 조립 |
| packages/fake-app | 연출용 가짜 앱: 가짜 코어·연결 연출·조절 화면 |
| packages/server | 코어 구현을 모르는 공통 HTTP·SQLite 껍데기 |
| packages/core-interface | 공유 요청·응답·오류와 Core 계약 |
| packages/core | 개발할 진짜 코어. 가짜 구현을 import하지 않음 |
| packages/fake-core | 연출용 문구와 결과 템플릿 |
| packages/client | 별도 문서 저장·조회 화면과 API 프록시 |

의존성 경계는 테스트로 강제합니다. server는 Core 인터페이스에만 의존하며 app과 fake-app이 구현을 주입합니다. 가짜 앱의 연출을 고쳐도 실제 앱이나 진짜 코어를 수정할 필요가 없습니다. 현재 구조는 [architecture](docs/architecture.md), 실제 API는 [api](docs/api.md), 독립 개발 계획은 [plan](docs/plan.md)을 따릅니다.

## 준비

Node 24.21.0·pnpm 10.13.1·just 1.58.0을 mise로 고정합니다.

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
just client       # 실제 앱 대상 문서 저장·조회 화면 :5173
just fake-client  # 가짜 앱 대상 같은 화면 :5174
```

연출 조절 화면은 **http://127.0.0.1:8081/__demo**입니다. 제목·도입·마무리, 지연, 실패 횟수를 적용하고 승인한 표현으로 재생성해 볼 수 있습니다. 가짜 앱은 실제 모델을 호출하지 않습니다. 실제 앱의 같은 재생성 API는 503 CORE_NOT_IMPLEMENTED를 반환합니다.

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
