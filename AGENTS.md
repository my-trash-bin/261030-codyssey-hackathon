# SafeHandoff 작업 규칙

저장소 전체에 적용한다. 사용자 최신 요청과 기존 승인을 먼저 적용한다.

## 현재 구조와 검사

현재 실행 코드는 pnpm workspace로 app·fake-app·server·core-interface·core·fake-core·client를 분리한다. app은 진짜 코어만 조립하고 fake-app은 연출용 가짜 코어와 연결부를 조립한다. server는 주입한 Core 계약만 사용한다. 진짜 코어는 아직 미구현이다. 그 외 제품 설계는 현재 구현 완료의 증거가 아니다.

- README.md: 실행·환경 변수·검사 진입점.
- packages/server: Core 계약에만 의존하는 Node HTTP API·SQLite 저장 껍데기.
- packages/core-interface: 공통 요청·응답·오류 계약.
- packages/core: 개발할 진짜 코어. fake 구현을 import하지 않는다.
- packages/fake-core: 연출용 결과 템플릿.
- packages/app: server와 진짜 core만 조립하는 최종 앱.
- packages/fake-app: 연출·연결 지연·실패와 가짜 코어를 조립하는 별도 앱.
- tools/architecture.test.mjs: workspace와 실제 import의 의존성 경계 검사.
- packages/client: 독립 화면·API 프록시와 테스트.
- mise.toml, pnpm-workspace.yaml, pnpm-lock.yaml: 도구·패키지·의존성 고정.
- .qg.yaml, justfile, package.json, tools/qg.test.mjs: 검사 실행과 정책 회귀.
- intent.md: 변경 승인이 필요한 프로젝트 의도.
- docs, contracts: 현재 구조 문서와 향후 제품 설계·참고 계약.
- scripts/demo: fake-app 전용 CDP 자막·재생·녹화. 실제 앱의 승인 구현으로 표시하지 않는다.
- docs/demo-media: 검증 시점이 표시된 제출 영상·미리보기.
- fixtures/demo: 가상 시연 원자료. 실제 정보가 아니다.
- evaluation: 이전 실행 기록. 현재 시스템 검증 결과와 구분한다.

한국어 문서·파일명을 명시적으로 허용한다. QG의 recommended 규칙과 공식 @slop-lab/qg-rules-js의 js preset을 사용하고 한국어·영어 문서 및 사용하는 기호를 설정한다. just check는 QG를 직접 실행하며 QG가 타입 검사·빌드·pnpm test를 호출한다. pnpm test는 Node 테스트만 실행하며 QG 전체 검사와 순환하지 않는다.

검증은 수정에 맞게 수행하고 현재 코드에 없는 기능을 완료로 보고하지 않는다. 과거 평가 파일·비공개 설정·로컬 DB를 임의로 삭제하거나 커밋하지 않는다. API 필드와 환경 변수 변경은 README와 docs/api.md에 함께 반영한다.

## 4. 명시적 승인이 필요한 변경

### 4.1 intent.md

**`intent.md`는 사용자의 명시적 승인 없이는 수정·삭제·대체하지 않는다.** 목적, 핵심 사용자, 가치, 원자료 처리 경계, 원문 사용 원칙, 사람의 결정 권한을 바꾸는 데 이 파일을 스스로 맞춰서는 안 된다. 형식 정리나 다른 문서와의 일치 작업도 이 파일을 실제로 바꾸려면 그 수정이 승인 범위에 들어 있어야 한다.

승인이 있다고 볼 수 있는 예는 ‘intent.md의 이 항목을 이 방향으로 바꿔라’처럼 대상과 변경 방향이 드러난 지시다. ‘구현해줘’, ‘정리해줘’, ‘테스트를 통과시켜줘’만으로 프로젝트 의도를 바꾸는 권한을 추정하지 않는다. 해당 파일의 초기 작성이나 변경을 요청한 지시가 있으면 그 범위에서 작업하고 같은 승인을 다시 받지 않는다.

승인이 필요한 변경을 발견했을 때는 다음을 수행한다.

1. 승인 없이 가능한 구현·분석·문서 정합성 작업은 계속한다.
2. 제안 변경문과 이유, 달라지는 범위·위험·관련 파일을 구체적으로 준비한다. intent 원본에는 적용하지 않는다.
3. 현재 승인으로 커버되지 않는 부분만 사용자에게 확인한다. 확인 이유가 `AGENTS.md`의 이 규칙임을 설명한다.
4. 승인되면 intent와 관련 PRD/spec/기능/시험을 함께 갱신하고 decisions에 남긴다. 거절되면 기존 의도 안의 대안을 따른다.

이 보호 규칙을 삭제·완화하거나 다른 파일로 옮겨 사실상 우회하는 변경도 같은 명시적 승인이 필요하다.

### 4.2 실제 운영 정보와 외부 행동

Q-LLM/Q-POLICY/Q-DEPLOY/Q-LICENSE를 임의의 실제값으로 채우지 않는다. 실자료 접근, 새로운 외부 모델, 외부 메시지·티켓·게시·자료 반출은 해당 행동에 대한 기존 사용자 승인과 실제 운영 권한이 필요하다. 문서 패키지나 PoC 구현 지시 자체로 이 행동이 모두 허가된 것은 아니다.

## 완료 보고

변경·검증 결과·미구현 범위를 구분한다. 과거 실행 기록을 현재 구현의 성공 근거로 사용하지 않는다.

## 커밋 메시지

한 줄로 쓰고 영어로 적는다. 접두는 소문자 `feat:`·`fix:`·`docs:`·`test:`·`refactor:` 중 하나를 쓰고, 콜론 뒤 본문은 영어 소문자로 시작한다. 내부 용어·에이전트 이름·작업자 이름은 넣지 않는다.
