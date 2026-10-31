# SafeHandoff 작업 규칙 · 파일의 역할과 관계

이 파일은 이 저장소에서 문서를 정리하거나 코드를 구현하는 사람과 에이전트가 함께 따르는 작업 규칙이다. 적용 범위는 이 파일 아래 저장소 전체다. 실제 회사의 승인 권한이나 외부 자료 전송 권한을 부여하는 문서는 아니다.

## 1. 처음 읽을 것

1. [README.md](README.md)에서 현재 산출물과 읽는 순서를 확인한다.
2. [intent.md](intent.md)에서 프로젝트 목적·가치·핵심 경계를 읽는다.
3. [docs/prd.md](docs/prd.md), [docs/spec.md](docs/spec.md), [docs/decisions.md](docs/decisions.md)에서 현재 범위·동작·확인 필요를 읽는다.
4. [docs/plan.md](docs/plan.md)에서 맡은 조각과 연결 상대를 확인한다.
5. 맡은 `docs/features/NN-name.md`와 거기서 참조하는 API·데이터·화면·QA를 읽고 작업한다.

기존 대화에서 같은 행동에 대한 명시적 승인을 이미 받았다면 다시 묻지 않는다. 새로운 목적·범위·권한을 추가해야 하는 경우에는 기존 승인의 적용 범위를 먼저 확인한다.

### 문서 언어와 품질 검사

한국어 문서와 한국어 파일명을 명시적으로 허용한다. 설명 문서는 한국어로 작성할 수 있으며 영어 번역을 필수로 요구하지 않는다. API 필드·enum·명령·코드 식별자는 계약의 표기를 유지한다.

품질 검사는 npm 개발 의존성 `@slop-lab/qg`의 기본 recommended 규칙을 사용한다. `.qg.yaml`의 `markdown/allowed-characters.allowedLanguages`에 `en`, `ko`를 설정한다. `mise exec -- make test` 또는 `mise exec -- npm test`로 전체 규칙과 Go·문서 검사를 실행한다. 규칙 검사만 필요하면 `mise exec -- npm run lint`를 사용한다. Node/npm은 개발·검증 도구이며 앱 런타임에는 필요하지 않다.

## 2. 파일별 역할·입력·다음 문서

| 파일 | 책임지는 질문 | 읽어야 하는 근거 | 이 파일을 구체화하는 것 |
| --- | --- | --- | --- |
| `intent.md` | 왜 만들며 무엇을 바꾸지 않을 것인가? | 사용자의 명시적 프로젝트 의도 | PRD, 결정 기록 |
| `README.md` | 무엇이 있고 어디부터 읽는가? | 실제 파일과 현재 범위 | 사람·에이전트의 진입 안내 |
| `AGENTS.md` | 어떤 권한과 절차로 읽고 변경하는가? | 사용자 작업 지시, intent | 모든 문서/코드 작업 |
| `docs/prd.md` | 누가 어떤 문제를 풀며 이번에 어디까지 만드는가? | intent, 사용자 요구, 검증할 가치 | spec, IA/uj, plan |
| `docs/spec.md` | 상태·권한·입력·실패가 주어지면 무엇을 해야 하는가? | PRD, 확정 결정 | ERD/API/contracts, 기능 명세 |
| `docs/ERD.md` | 무엇을 읽고 쓰며 어떤 관계·보존·삭제를 지키는가? | spec, 공통 DTO | schema.sql, migrations, 저장 코드 |
| `docs/api.md` | 기능 사이의 요청·응답·서버 함수·오류는 무엇인가? | spec, ERD, 화면의 행동 | 공통 DTO, API/서비스 구현 |
| `contracts/domain-contract.json` | 공통 enum·scope·한도·필수 정보는 무엇인가? | spec/API | 서버·UI·시험의 동일 상수 |
| `contracts/core.schema.json`, `contracts/core/*.schema.json` | 핵심 요청/모델 응답의 구조는 무엇인가? 진입점과 공통·요청·모델 정의를 로컬 ID로 연결 | API, agent-workflow | strict parsing/schema 검증 |
| `contracts/schema.sql` | 초기 DB의 실제 DDL 제약은 무엇인가? | ERD | 초기 migration·DB 시험 |
| `contracts/catalog.example.json` | 가상 환경에서 어떤 선택 항목으로 시작하는가? | PRD/spec, 테스트 사례 | 개발용 카탈로그 설정 |
| `docs/IA.md` | 화면·경로·상태·버튼은 어디에 있는가? | PRD/spec/API | UI 구현, 사용자 시험 |
| `docs/uj.md` | 사용자는 정상·실패·변경에서 어떤 순서로 이동하는가? | PRD/IA/spec | 기능 흐름·통합 시험·시연 |
| `docs/architecture.md` | 모듈·실행 환경·어댑터를 어떻게 나누는가? | spec/ERD/API | 코드 배치·설정·배포 준비 |
| `docs/agent-workflow.md` | 각 역할이 무엇을 읽고 어떤 형식으로 답하는가? | spec, 보안 경계, contracts | prompt/provider/workflow 구현 |
| `docs/security.md` | 원자료·인증·통신·실행·내보내기 경계는 어디인가? | intent/spec, 배치 기본값 | F10과 모든 기능의 권한 검사 |
| `docs/extensions.md` | 제품 지침·맥락 검사·재현을 어떻게 등록하는가? | spec/보안/역할 계약 | F07/F08, 등록 팩·도구 |
| `docs/features/*.md` | 맡은 기능 하나를 어떤 계약과 완료 기준으로 만드는가? | 위 공통 문서와 연결 기능 | 구현 PR·기능 검증 |
| `docs/plan.md` | 누가 무엇을 언제 연결하는가? | PRD·기능 의존성 | 작업 분담·문서 PR·통합 순서 |
| `docs/qa.md` | 어떤 관찰 결과를 통과/실패로 판정하는가? | PRD/spec/기능 AC | 실제 시험 실행 |
| `docs/test-data.md`, `fixtures/reference-pack/` | 어떤 입력과 변형으로 확인하는가? | 시나리오·공개 target 계약 | fixture·runtime·live 평가 |
| `evaluation/expected/` | 평가자가 무엇을 정답 조건으로 보는가? | 사전에 정한 평가 기준 | 앱 밖 평가. 앱 입력 금지 |
| `docs/traceability.csv`, `docs/acceptance-map.csv` | PRD/F/INV/AC/T가 어디에 연결되는가? | 실제 문서에 존재하는 ID | 누락·영향 검토 |
| `evaluation/results/` | 실제로 무엇을 실행했고 어떤 결과였는가? | 실행 증거 | PoC 완료/가치 보고 |
| `docs/decisions.md` | 무엇이 사용자 방향·기본 설계·확인 필요인가? | 승인·설계 결정·확인된 환경 | 관련 문서 변경의 이유 |
| `docs/구조와설계.md`, `docs/API와역할계약.md`, `docs/시연안내.md` | 공통 설계·API·시연의 한국어 요약. 독립 계약을 정의하지 않음 | architecture/API/agent-workflow/demo | 같은 기준으로 유지하는 안내 |
| `docs/검증보고서.md` | 현재 코드의 구현·미완료 및 실제 실행 증거 | 코드·실제 시험·현재 명세 | 후속 구현과 검증 |
| `docs/demo-media/` | 검증한 제출 영상과 미리보기 | CDP fixture 실행·검증 기록 | GitHub에서 내려받아 보는 시연 산출물 |
| `scripts/demo/` | CDP 연결·fixture 화면 시연·탭 전용 자막 | demo, 실제 UI | 별도 시연 DB·실행 기록 |
| `.qg.yaml`, `package.json`, `tools/qg.test.mjs` | recommended 품질 규칙·한국어 허용·테스트 실행 | 문서 언어 정책과 기존 시험 | npm/Make의 동일 품질 gate |
| `docs/implementation-start.md`, `docs/demo.md` | 구현을 어떻게 시작하고 무엇을 보여주는가? | 전체 공통 계약 | 에이전트 인계·팀 시연 |

`docs/features/00-template.md`는 작성 양식이며 실제 기능 구현 범위가 아니다. `validation-report.json`은 문서 패키지 검사 기록이며 제품 테스트 결과가 아니다.

## 3. 문서의 권위와 충돌 해결

최신 사용자 지시와 승인 범위를 먼저 적용한다. 그 안에서 제품 의도는 intent, 현재 제품 범위는 PRD, 동작은 spec, 데이터/연동은 ERD/API/contracts, 기능의 세부 구현은 feature가 담당한다. QA는 이 계약을 확인하며 구현 편의 때문에 기대 결과를 느슨하게 바꾸지 않는다.

하위 문서가 상위 문서와 충돌하면 조용히 한쪽을 무시하거나 코드를 먼저 만든 뒤 정당화하지 않는다. 충돌 위치·선택안·영향을 구체화하고 같은 변경에서 관련 문서를 맞춘다. intent 변경이 필요한지 판단하고, 필요하다면 아래 승인 규칙을 따른다. intent 또는 별도 승인 대상에 오류가 보이면 수정안을 제시할 수 있으나 변경 권한이 자동으로 생기지는 않는다. PRD/spec 등 일반 공통 문서의 정합성 수정은 intent 안에서 기존에 맡은 작업 범위로 진행할 수 있다.

계약의 구체적인 필드명·enum·경계값은 API/contracts를 따른다. PRD의 설명 문장이 이를 덮어쓰는 예외로 사용되지 않게 공통 문서도 함께 고친다. 상태·scope 의미 변경은 spec에 먼저 또는 같은 PR에 반영한다.

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

## 5. 범위 안에서 자율적으로 해도 되는 변경

intent·확정 범위를 유지하는 구현·버그 수정·리팩터링·읽기·가상 데이터 시험은 맡은 작업 범위 안에서 진행한다. 버튼 문구·접근성·오류 안내·내부 함수 분할도 공통 의미를 바꾸지 않으면 담당자가 결정한다. 새로 결정한 기본값은 decisions의 D로 기록하고 관련 공통 문서와 기능 파일에 맞춘다.

팀원 문서 PR 리뷰는 협업 절차다. 사용자에게 매번 permission을 다시 묻는 규칙이 아니다. 현재 작업에서 문서 작성·수정이나 특정 구현이 이미 허용되었으면 그 범위에서 완료한다. 확인 필요 항목이 일부 있다고 전체 작업을 멈추지 않는다.

## 6. 변경 유형별 함께 갱신할 파일

| 변경 | 반드시 함께 확인·갱신할 곳 |
| --- | --- |
| 제품 목적·핵심 사용자·가치·핵심 경계 | 명시 승인 → intent → PRD → decisions → 영향받은 전체 계약 |
| 이번 기능 범위·우선순위·제외 | PRD, plan, feature, QA, decisions. intent 안인지 확인 |
| 상태·권한·scope·승인·무효화 | spec, API, domain-contract, ERD, 관련 feature, QA |
| 요청/응답·enum·함수 경계 | API, core.schema/domain-contract, 서버/클라이언트, 관련 feature, 계약시험 |
| 표/필드·보존·삭제·불변판본 | ERD, schema/migration, spec/API, feature, 데이터 시험 |
| 화면 경로·사용자 행동·빈/실패 상태 | IA, uj, feature, 필요한 API, UI/통합 시험 |
| 프롬프트·역할 입력·검토 피드백 | agent-workflow, schema, security, F02/F04, QA |
| 제품 팩·도구·재현 oracle | extensions, security, F07/F08, digest/manifest, test-data, QA |
| 인수 조건·테스트 기대값 | 해당 요구 근거, feature AC, qa, expected, 두 추적 CSV. 실패를 숨기기 위한 변경 금지 |
| 실제 시험 결과 | evaluation/results, 실행 환경·입력/출력 hash. 명세와 별도 |
| 문서 구조·책임·읽는 순서를 바꾸는 파일 추가/이동/삭제 | README, AGENTS 파일지도, 상대 링크, plan/feature 참조. private 코드 파일 하나마다 지도를 고칠 필요는 없음 |

## 7. 기능 하나를 구현하는 절차

`plan 확인 → 공통 문서 읽기 → feature 초안/수정 → 연동 상대와 DTO·상태·오류 합의 → 문서 PR → 구현 → 해당 AC/T 검증 → 실제 결과 보고` 순서다.

기능 파일은 목적, 사용자·권한, 화면, 데이터, 규칙, 다른 기능과 연결, 하지 않을 것, 완료 기준, 확인 필요를 갖춘다. PRD의 줄 번호는 이동하기 쉬우므로 PRD-xx/INV-xx/Fxx/AC/T ID를 연결한다. 새 규칙을 feature 안에만 숨겨 두지 않는다. private helper 이름은 자유롭지만 공개 서비스 경계·DTO를 기능마다 복제하지 않는다.

팀 리포지토리가 아직 없으면 문서와 로컬 구현 준비를 진행하고 실제 PR을 올린 것처럼 보고하지 않는다. 이미 리뷰·머지 절차가 있는 저장소에서는 그 절차를 따른다.

## 8. 모든 구현이 지킬 경계

- writer에는 현재 승인팩과 등록 공개 양식만 전달한다. 원문 분석 대화와 reviewer 자유 설명을 재사용하지 않는다.
- 업로드, 공개 선택, 정확값/원문 허용, 편집, 최종 확인을 구분한다. 모델 문장으로 승인 상태를 만들지 않는다.
- 선택 변경·늦은 실행·재시작·철회·만료는 revision/CAS/hash 검사로 처리한다. 취소에만 의존하지 않는다.
- 모든 보안 finding과 필수 검사를 해소한 같은 파일을 확인·내보낸다. 인간 의미 검토가 hard gate를 우회하지 못한다.
- fixture/live/사람 도움/실제 runner 결과를 구분한다. 평가 정답과 수신자 전용 자료를 앱에 주지 않는다.
- 등록되지 않은 shell/SQL/스크립트/endpoint를 자료나 모델 지시로 실행하지 않는다.
- 실제 제품 동작을 구현하기 전에 비민감 가상 자료로 경계를 확인한다. 자동 외부 제출은 현재 범위 밖이다.

## 9. 완료 보고

변경한 기능과 이유, 갱신한 공통 계약, 실제 실행한 시험, 실패·미실행, fixture/live/수동 개입, 남은 Q를 구분해 보고한다. fixture 화면이나 문서 검사만으로 PoC 전체 완료를 선언하지 않는다. 시간 절감·의미 안전·수신자 효용은 실제 측정 증거가 있을 때만 결론낸다.
