# SafeHandoff

공유본 준비 시스템을 다시 구현하기 위한 TypeScript 기본 작업 공간입니다. 현재 기능은 **텍스트 문서의 SQLite 저장·조회**뿐입니다. 분석·공개 승인·재생성·모델 연결은 아직 구현하지 않았습니다.

## 패키지

| 경로 | 역할 |
| --- | --- |
| packages/server | Node HTTP 서버와 SQLite 저장·조회 |
| packages/client | 텍스트 입력·목록 화면과 서버 API 프록시 |
| fixtures/demo | 다시 사용할 수 있는 가상 시연 원자료 |
| docs, contracts | 제품 설계·이전 계약 자료. 현재 구현과 구분 |
| evaluation | 이전 실행 기록. 현재 시스템의 검증 결과가 아님 |

프로젝트 의도는 [intent.md](intent.md), 현재 구조는 [architecture](docs/architecture.md), 실제 API는 [api](docs/api.md)에 있습니다.

## 준비와 실행

Node 24.21.0, pnpm 10.13.1, just 1.58.0을 mise로 고정합니다.

```bash
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
cp .env.example .env  # 기존 .env가 있으면 생략
```

두 터미널에서 각각 실행합니다.

```bash
mise exec -- just server
mise exec -- just client
```

클라이언트는 **http://127.0.0.1:5173**, 서버는 **http://127.0.0.1:8080**입니다. 기본 수신 주소는 0.0.0.0이므로 사내 IP에서도 같은 포트로 접속할 수 있습니다. 종료는 각 터미널에서 Ctrl-C입니다. 패키지의 dev 명령은 루트 .env를 자동으로 읽으며 이미 설정된 환경 변수가 우선합니다.

DB 기본 경로는 `.local/data/safehandoff.sqlite`입니다. DATABASE_PATH로 바꾸며 상대 경로는 저장소 루트를 기준으로 합니다. 이전 로컬 DB와 설정 파일은 읽거나 이전하지 않습니다. 현재 화면은 단일 사용자 개발용이며 사내 인증은 아직 없습니다.

## 검사와 빌드

```bash
mise exec -- just check
mise exec -- pnpm test
mise exec -- pnpm build
```

just check는 QG를 직접 실행합니다. QG가 recommended 규칙, TypeScript 타입 검사, 두 패키지 빌드, pnpm test를 호출합니다. pnpm test는 각 패키지 Node 테스트와 QG 정책 회귀 테스트만 실행하며 QG 전체 검사를 다시 호출하지 않습니다. 한국어 문서·파일명을 허용합니다.

빌드한 패키지는 각각 `pnpm --filter @safehandoff/server start`, `pnpm --filter @safehandoff/client start`로 실행합니다. 클라이언트의 SERVER_ORIGIN은 서버 API를 프록시할 주소입니다. 브라우저는 클라이언트와 같은 origin으로 요청합니다.
