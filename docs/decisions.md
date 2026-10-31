# 결정 기록과 확인 필요

> 보존한 제품 설계·이전 기록이다. 현재 구현은 TypeScript 서버·클라이언트의 문서 저장·조회만 제공한다. 현재 실행과 API는 [README](../README.md) 및 [api](api.md)를 따른다.

기준일 2026-10-31. **U**는 대화에서 정한 제품 방향, **D**는 이 묶음을 구현 가능한 한 안으로 만든 기본 설계, **Q**는 실제 조직/환경 정보를 확인해야 하는 항목이다. D를 사용자의 과거 확정 발언으로 표현하지 않는다. 실행 가능성을 위해 정한 숫자는 측정 결과가 아니다.

## 1. 사용자 방향 U

| ID | 결정 | 연결 |
| --- | --- | --- |
| U01 | 핵심 가치는 공유용 자료 준비 보조. 보안 위협 차단 자체를 주된 차별성으로 주장하지 않음 | PRD-01/13 |
| U02 | OSS 버그 제보와 B2B 지원 두 메인 사례, 일반 내부 자료에도 적용 | PRD-02 |
| U03 | 회사별 사내 실행 OSS. 이미 있는 사내 LLM 전제. 특정 모델·GPU/VRAM 최적화는 선행 조건 아님 | PRD-03 |
| U04 | 전체 새 작성 기본. 원문 그대로 사용은 사람이 승인한 범위만 | PRD-06, INV-04/05 |
| U05 | 필요한 정보와 공개 수준을 작성 중에도 질문·선택. A/B/C/D와 직접 입력 지원 | PRD-05 |
| U06 | 검토 역할이 작성 단계에 참여. 마지막 후처리만으로 설명하지 않음 | PRD-07 |
| U07 | 목적/상대/상황이 맞는 선택 재사용. 맥락 검사·제품/라이브러리 지침 확장 | PRD-09/10 |
| U08 | 합성 재현 확인은 주요 확장 사례. 재현할 수 없는 경우에도 문의 준비 가능 | PRD-11 |
| U09 | 원자료 접근 에이전트의 인터넷 접근을 차단하는 사내 실행 경계를 제시 | PRD-03, INV-01 |
| U10 | 자동 제출은 핵심 범위에서 제외. 티켓 연결은 나중의 작은 편의 | PRD-14 |
| U11 | 가치와 차별점은 실제 준비 수고·결과 쓸모로 검증. 유료 BM 제품을 억지로 설정하지 않음 | PRD-13/14 |
| U13 | intent 변경은 명시 승인만; AGENTS에 파일 역할·관계·변경 권한을 기록 | intent, AGENTS |
| U12 | 맡은 기능마다 목적·권한·화면·데이터·규칙·연동·제외·완료·미정을 기록하고 공통 문서와 함께 유지 | 전체 features, plan |

## 2. PoC 기본 설계 D

| ID | 이번 기준 | 왜 이 값/구조인가 | 변경 시 함께 볼 곳 |
| --- | --- | --- | --- |
| D01 | Go 단일 앱, SQLite BLOB, 서버 HTML+순수 JS | 이전 구현안을 이어 배포/분담 복잡도 제한 | architecture, ERD, plan |
| D02 | 단일 OS 소유자·기본 loopback, 명시적 사내 IP 바인딩 지원, 계정/SSO 없음 | 핵심 업무 흐름을 먼저 검증 | security, F10 |
| D03 | 일회 토큰5분·세션8시간·터미널 입력, Host/Origin/CSRF | 로컬 앱도 브라우저 요청 경계 정의 | api, F10 |
| D04 | 사내 모델 교체 어댑터, fixture/live DB분리·동시성1 | 성능 낮은 모델에서도 제어 흐름을 검증 | agent-workflow, architecture |
| D05 | text/log/md/csv/json, 10개·256KiB/개·1MiB/작업 | 파싱/파일 의미를 작게 제한 | F01, schema, QA |
| D06 | 승인팩/DocAST/슬롯과 내부 mapping 분리 | writer 입력과 출력 파일 범위를 명확히 함 | F02–F05, contracts |
| D07 | revision/job/artifact_version을 분리, CAS 집행 | 동시 탭·늦은 호출·선택 변경 뒤 결과 혼합 방지 | spec, ERD, F09 |
| D08 | A 사실, B 방향, C 실제 선택 필드, D 등록 변환 해석 | 사용자가 공개 의미를 결과로 비교 가능 | F03, test-data |
| D09 | 820/1160/1740, 지수100/141/212, 정수 기본 HALF_UP | 발표 예시·fixture·테스트 일치 | transforms, QA |
| D10 | 정확값·원문 허용은 reusable=false | 새 자료의 새 값에 과거 허용을 확대하지 않음 | F03/F06 |
| D11 | 저장 기준은 exact scope+검증 schema/selector 일치 | 의미 유사도와 허가를 분리 | F06, rule contracts |
| D12 | goal_variant로 관찰/진단질문/재현목표 구분 | 재현 실패/ID제외 뒤 무엇을 완료할지 명확화 | PRD/spec, F01/F03/F08 |
| D13 | fixed target+정형 oracle, 가상 toy 네 실행 | 준비 예제의 재현 확인을 실제로 보여줄 수 있음 | F08, test-data |
| D14 | 원문/이력 사용자 삭제까지, raw 모델 trace off; opt-in24시간 | 불필요한 원문 복제 줄이되 평가 metadata 유지 | security, ERD, F09 |
| D15 | 작업 삭제와 입력 제외/기준 철회 분리 | 기록 삭제의 의미와 범위 명확화 | F01/F06/F09 |
| D16 | 모든 보안finding 해소필수, severity는 표시 우선순위 | 담당자별 무시/차단 기준 차이 방지 | F05/F07, api |
| D17 | 제한 재시도(2회), 수정2회, run총12회 | 무한 자동 수정 대신 실패·사람 경로 표시 | F04, QA |
| D18 | 카탈로그는 로컬 설정, 사용자 UI는 선택/상태조회만 | 첫 PoC 관리기능 범위 제한 | F01/F10, api |
| D19 | 재시작 queued/running 모두 failed/INTERRUPTED | 숨은 자동재개 없이 사용자가 실행상태 파악 | F09, spec |
| D20 | 제목만 바뀌어도 revision 증가·stale | 첫 PoC 무효화 규칙 단순화 | spec, F01/F09 |
| D21 | 한국어 문서·파일명 허용, npm QG recommended 규칙과 Go·문서 시험 연결 | 사용자 요청에 따라 언어 정책을 명시하고 검사 진입점을 통일. Node는 개발 도구로 한정 | AGENTS, .qg.yaml, package.json, justfile, architecture |
| D22 | 앱·live evaluator가 선택적 .env 자동 로딩, 기존 환경 변수 우선 | 사용자 요청에 따라 source/export 없이 실행. 설정 오류는 비밀 값 없이 원인 필드 구분 | architecture, F10, implementation-start, .env.example |
| D23 | 기본 loopback 유지, 명시한 wildcard/서버 IP listen 지원, Host와 listen 분리 | 사용자 요청에 따라 0.0.0.0 바인딩에서도 서버 IP로 접속. 인터페이스 IP 및 allowed_hosts만 허용하고 Origin·CSRF 유지 | PRD, spec, API, security, F10, QA |
| D24 | Make에서 just로 전환, .local/run 기반 단일 백그라운드 서버 관리 | 사용자 요청에 따라 start/stop/restart/status/logs 제공. 시작 식별자·PID 소유 검증, DB 보존 | justfile, mise, QG, server.py, README, architecture |

런타임/드라이버 버전은 실제 빌드 호환성을 확인해 잠근다. 버전 선택만으로 제품 범위를 재질문할 필요는 없다. 현재 기본값으로 진행할 수 없는 실제 제약이 확인되면 D 변경 PR로 기록한다.

## 3. 실제로 확인할 Q

| ID | 필요한 답 | 언제 막히는가 | 그 전까지 가능한 작업 |
| --- | --- | --- | --- |
| Q-LLM | 사내 endpoint·인증·모델명·입력/출력한도·기록/보관·API호환성 | live 연결/실자료 모델 호출 | fixture·도메인·UI·strict schema·실패 흐름 |
| Q-POLICY | 실제 공유 승인권자·공개 제한·보존/삭제 정책·사람 검토 책임 | 실자료 사용/실제 반출 | 가상 사용자 역할·정의된 샘플 정책 |
| Q-EXT | 첫 실제 제품/라이브러리·버전·공개 지침·재현 환경·oracle | 실제 제품별 팩/실버그 검증 | toyrecord/VendorStore-Lab/운영자료 가상팩 |
| Q-DEPLOY | OS·네트워크차단·내부모델예외·Docker/격리권한·파일저장 | 실제 배치·경계 검증 | loopback 가상자료·runner계약·환경없음 흐름 |
| Q-TEAM | 누가 역할A/B/C(/D), 문서/인터페이스 리뷰어인지 | 실팀 작업 배정/PR 승인 | 역할별 슬롯으로 준비된 plan 사용 |
| Q-LICENSE | 공개 라이선스·사내 코드/문서 공개 권한·의존성 고지 | OSS 공개/배포 | 비공개 PoC 구현, 라이선스 후보 검토 |

확인 담당자는 팀이 실제 사람을 배정한다. 답이 없으면 실제값을 임의로 채우지 않는다. 이 Q들은 설계 문서 전체를 대기시키는 이유가 아니다. 위 마지막 열까지는 지금 시작할 수 있다.

## 4. 이전 자료와의 관계

이 묶음은 이전 단일 구현 명세를 최신 사용자 결정에 맞춰 분해·보완한 구현 기준이다. 발표자료는 문제·사용 흐름을 설명하는 자료이고 API/DB 계약의 권위가 아니다.

현재 적용할 기준:

- 자동 제출·승인하고 보내기 대신 파일 확인·복사·다운로드.
- 특정 모델/24GB GPU/서빙 런타임 대신 이미 있는 사내 LLM.
- 재현 성공만을 유일한 완료 조건으로 두는 흐름 대신 목표별 관찰 문의.
- 후처리 마지막에만 검토기 배치 대신 작성 중 검토와 질문 복귀.
- 초기 수치82/120/176 대신820/1160/1740, 지수는 정수100/141/212 기본.
- 스크린샷이 주요 입력이라는 오해를 피하도록 실제 지원 형식과 메인 사례 고정.
- 보안 차단 제품이라는 과장 대신 준비 작업 보조와 실제 비교 평가.

기존 로컬 단일 명세도 자동 제출·특정 GPU 요구를 제외하고 작성 중 검토·환경 없는 문의를 요구했다. 이 원칙들은 유지하며, goal_variant·접속 토큰·trace 보존/삭제·수치 기본값 등 구체 계약은 현재 spec/API로 통일한다.

기존 한국어 안내 `구조와설계.md`, `API와역할계약.md`, `시연안내.md`는 공통 설계의 요약이며 별도 계약이 아니다. 현재 코드와의 차이는 검증보고서에만 구현 상태로 기록한다. 기존 OpenAPI·개별 역할 schema는 코드 생성 산출물이므로 새 계약과 맞도록 구현을 전환할 대상이다.

최신 전체 발표자료의 흐름은 유지한다. 필요시 [팀 설명 PDF](https://chatgpt.com/library?file_id=libfile_d1e4f3e46cac819187548fda4fd237bf&account_id=personal)를 배경으로 읽을 수 있지만 구현은 이 묶음의 공통 계약을 따른다.

## 웹·엔진 분리 결정

- U: 사용자가 웹과 실제 공유본 재생성 시스템을 분리하고 임시 interactive 시연과 실제 엔진을 독립 시험하도록 요청했다. 기존 내부 로직의 유지도 필수로 두지 않았다.
- D: 새 경로는 stateless regeneration.v1 HTTP/CLI 엔진과 별도 웹 게이트웨이로 구성한다. demo/live는 같은 API를 사용하며 프로세스·포트·로그를 분리한다. 기존 작업 DB는 새 경로와 연결하지 않는다.
- D: 새 작성기와 검토기에는 승인한 표현만 전달한다. 화면은 선택 변경·편집·늦은 응답의 판본을 검사하고 현재 문서 검토와 사람 확인 뒤 다운로드한다. demo 고정 응답은 live 결과로 표시하지 않는다.
- U: `npm test`는 Node 테스트, QG는 Node·Go·문서·서버 관리 테스트를 호출하고 just check는 QG를 직접 실행한다. 실제 모델·브라우저 실행 시험은 별도 명령으로 둔다.
- 범위: [독립 실행 계약](separated-runtime.md)에 미연결 확장과 비영속 작업 공간의 한계를 명시한다. 기존 전체 명세를 새 경로의 완료 증거로 사용하지 않는다.

## 5. 새 결정을 추가할 때

변경 내용, 이유, 영향받는 PRD/INV/F/API/테이블/T, 이전 결과·규칙의 호환성, migration/재검토 방법을 한 항목으로 남긴다. 요구 의미가 달라지면 PRD/spec을 먼저 또는 같은 PR에서 고친다. 이미 확인한 계약을 기능 파일만 수정해 우회하지 않는다.

문서 리뷰의 목표는 줄 수를 채우는 것이 아니라, 다른 담당자가 같은 요청·실패·동시 변경에서 같은 결과를 만들 수 있게 하는 것이다.

## 현재 구현 초기화

사용자 요청으로 기존 실행 코드를 제거하고 pnpm workspace의 TypeScript 서버·클라이언트만 남겼다. 현재 기능은 Node HTTP와 SQLite의 문서 저장·조회다. pnpm test는 Node 테스트를 실행하고 QG가 타입·빌드·테스트를 호출하며 just check가 QG를 직접 실행한다. 이전 결정표의 실행 기술·명령·구현 범위는 현재 코드에 적용하지 않는다. 프로젝트 의도·상세 제품 설계·시연 원자료·과거 평가 기록은 보존한다.

## 실제 앱과 연출용 껍데기의 독립 개발

사용자는 실제 서버 껍데기·가짜 코어·가짜 앱 연결부·진짜 코어·인터페이스의 분리를 요청했고 최종 조립 명칭은 app으로 확정했다. core-interface를 공통 계약으로 두며 server는 구현 대신 Core를 주입받는다. app은 server와 core, fake-app은 server와 fake-core를 조립한다. 지연·실패 연출은 fake-app 내부에서만 제공한다. 진짜 코어가 미구현이면 오류를 반환하며 가짜로 대체하지 않는다. 공식 QG js preset과 패키지 의존성 회귀 시험으로 경계를 검사한다. 개발 계획은 연출 트랙과 실제 코어 트랙을 독립 작업으로 반영한다.

## 엔진 워크플로우 인터페이스 1라운드

사용자는 docs/features의 보존된 과거 워크플로우(원자료 분석 → 공개 결정 → 승인 fact pack → 작성/검토 루프 → [선택] 재현 검증)를 되살리는 방향으로 가되, 이번 라운드는 TypeScript 인터페이스·패키지·책임 경계 정리까지만 하기로 결정했다("넓게, 일단 인터페이스/역할/책임 정리만").

- D: `Core.generate()`(승인된 사실만 받는 writer 계약)는 그대로 두고, `analyze/proposeDisclosure/preview/write/review/reproduce`를 노출하는 `Engine extends Core`를 core-interface에 신설한다(`packages/core-interface/src/workflow.ts`). `decide()`는 두지 않는다 — 공개 결정은 사람이 하는 단계이므로 Engine은 제안·미리보기만 돕고, 실제 `Decision[]`은 server가 만들어 `composeFactPack` 입력으로 넣는다. Engine은 stateless를 유지한다.
- D: 재현 러너(F08: 사전 등록된 digest 고정 target만 실행, 모델이 코드를 짜지 않음)는 `packages/sandbox-runner`로, 모델 전송(openai_compatible)은 `packages/model-adapter`로 core-interface에만 의존하는 별도 리프 패키지로 분리한다. core는 둘 다 직접 import하지 않고 core-interface의 포트 타입(`ReproRunner`, `ModelClient`)만 알며, 실제 구현체는 app(합성 루트)이 주입한다. `tools/architecture.test.mjs`의 `allowed` 맵에 두 패키지를 추가했다.
- D: 신규 타입(`CandidateProposals`, `FactPack`, `Draft`, `Review`, `ReproduceRequest/Result`, `TargetRun`, `ModelClient`, `ProviderConfig` 등)의 필드명은 contracts/*.v1.schema.json과 config.json을 직접 읽어 1:1로 맞췄다. task.v1 전체(서버측 영속 집계, scope/jobs/artifacts/events 포함)는 core-interface에 들여오지 않고, core가 실제로 쓰는 필드만 축소판으로 뽑았다(예: `Decision`은 `raw_grants`/`scope`/`applied_rule_*` 같은 서버 감사 필드를 뺀 `candidate_id/disposition/representation/expires_at/revoked`만).
- D: `DockerReproRunner`/`OpenAICompatibleModelClient`는 `RealCore`와 같은 "명시적 미구현 seam" 패턴(가짜로 대체하지 않고 `REPRO_UNAVAILABLE`/`MODEL_UNAVAILABLE`을 던짐)으로만 스캐폴드했다.
- 다음 라운드로 미룬 범위: `composeFactPack`/`judgeReproduction`의 실제 로직, `RealCore`의 analyze/write/review 오케스트레이션과 `ModelClient`/`ReproRunner` 실제 주입, `DockerReproRunner`의 실제 dockerode 컨테이너 실행(네트워크 차단·digest 검증·리소스 제한), `OpenAICompatibleModelClient`의 실제 HTTP 호출, server의 task/decision 저장 스키마. F07 `context_check`는 부차적이라 이번 라운드와 다음 라운드 모두에서 제외했다.

## 2026-10-31 · 2a deterministic transforms and HTTP transport

- `composeFactPack` consumes the server-validated current decision set and preview projections. Candidate IDs are `local_key`; fact/table/slot IDs are decision IDs. Duplicate current decisions and ambiguous/stale previews fail closed. The server remains responsible for scope, source and projection hash verification before calling this reduced interface.
- Expiring decisions require an explicit `now` epoch-millisecond argument; expired/revoked/non-allow decisions contribute nothing. Excerpts remain renderer references. The output language defaults to `ko`.
- `judgeReproduction` checks the `buggy/fixed × ascii/multibyte` matrix, exit/stdout consistency and runner-observed output flags before applying F08's oracle. Timeout exit codes 124/137 produce `error/REPRO_TIMEOUT`.
- `OpenAICompatibleModelClient` resolves provider environment names at construction, rejects unapproved plaintext URLs and redirects, bounds input/response size and in-flight calls, and supports cancellation/timeouts. One `complete` call makes one HTTP attempt; Engine owns retry and aggregate call budgets.
- Tests use contract examples and a local Node HTTP server only. No external model or real source data is used. Docker execution and server task/decision persistence remain separate work.

## 2026-10-31 · 2b writer/reviewer Engine subset

- `RealCore` implements `Engine` and accepts `ModelClient`, `EngineConfig` and optional `ReproRunner` through its constructor. Configuration is supplied by the caller; core does not read private config files or environment variables.
- `write` and `review` each enforce per-step attempt limits. `writeReviewed` shares the total model-call budget across writing, review, retries and repairs, and stops at `max_review_repairs`. Nonpassing results stay nonpassing; `needs_decision` never starts an automatic rewrite or disclosure expansion.
- `generate` preserves the existing approved-facts HTTP contract and performs one writer/reviewer exchange (`maxRepairs: 0`), with bounded retries inside each step. It returns a document only after a passing review. Model errors map to existing Core error codes.
- Strict response validation rejects unknown/duplicate fields and unknown fact/block/slot references. Repair feedback contains only fixed reason codes and validated block/fact IDs, excluding free-form reviewer explanations, actions and candidate IDs.
- `analyze`, `proposeDisclosure`, and `preview` remain explicitly unimplemented. Reproduction delegates only to an injected runner when enabled; Docker execution remains unimplemented. The app entrypoint still constructs an unconfigured core and makes no external model calls.
- Round 3 remains separate: Docker implementation requires the requested security review, and server task/decision persistence requires a scoped plan before coding. Neither is implemented in this round.

## 2026-10-31 · 3라운드 연결과 범위 축소

- 사용자 요청에 따라 모델 환경 변수 세 개와 선택 설정/실행기 등록 경로를 .env.example에 추가했다. 기존 예제의 서버·클라이언트 변수는 모두 사용 중이므로 보존했다. 기존 .env와 config.json의 실제 값은 변경하지 않았다.
- 앱은 ModelClient와 선택 ReproRunner를 조립하며 설정 없는 모델에 가짜 결과를 주입하지 않는다. 모델 HTTP 전송은 환경 프록시·전역 fetch 설정의 영향을 피하는 직접 native HTTP/TLS 요청으로 바꿨다. 모델 통신은 사용자 생성 요청 때만 발생한다.
- 저장 코딩 전에 round3-scope.md에 축소 범위를 기록했다. 전체 제품 schema 대신 workflow 접두사의 내부 테이블과 migration, fact_summary 미리보기·사람 결정 배치·철회·만료만 구현했다. 인증 없는 task HTTP API는 추가하지 않았다.
- 실행기는 scratch 이미지 안의 고정 toy target과 supervisor만 실행한다. supervisor가 실제 파일을 관찰하고 호스트가 출력 바이트를 대조한다. 이미지 전체 ID와 요청의 target/input digest를 확인하고 런타임 pull/build·호스트 경로 mount·임의 명령을 허용하지 않는다.

- 3라운드 수동 보안 검토에서 내부 task purpose의 승인 brief 자동 복사를 제거하고 모델 pass에 필수 fact 참조 coverage 검사를 추가했다. 전용 /security-review 실행을 대신했다고 주장하지 않으며 검토 방법·시험·운영 한계는 [검토 기록](round3-security-review.md)에 남겼다.

## 2026-10-31 · 실제 등록 모델 smoke test 후 호환 수정

- 사용자가 명시적으로 승인한 기존 모델에 가상 사실만 전송해 실제 앱 프로세스의 작성·검토 왕복을 실행했다. 최종 HTTP 200과 불확실성 표현 유지를 확인했다. 상세 범위와 첫 실패·수정은 [실행 기록](live-smoke-2026-10-31.md)에 남겼다.
- provider.response_mode=text는 모델 호출자가 JSON 출력을 원해도 response_format 전송을 금지한다. 작은 호환 서버의 기능 설정을 우선하며 응답은 기존 JSON parser로 엄격하게 검증한다.
- 검토 프롬프트가 schema_version을 명시하도록 보완했다. 필수 응답 필드를 생략한 모델 출력을 통과시키는 fallback은 추가하지 않았다.

## 2026-10-31 · F07 도메인 확장 계약 2라운드

사용자 요청에 따라 F07(제품별 지침 팩·맥락 검사·도구 registry)도 1라운드와 같은 방식으로
먼저 TypeScript 계약만 정리했다. 샌드박스(`ProcessToolRunner`)와 팩 로더/검증기
(`SkillPackLoader`/`validatePackLayout`)를 이번 계약 범위에 포함했고, task/역할/도구/워크플로우를
포함한 다음 구현 순서는 [F07 계약과 다음 구현 순서](f07-extensions-plan.md)에 기록했다.
OverlayFS 대신 읽기전용 bind mount + tmpfs를 쓰기로 했다(`DockerReproRunner`가 이미 쓰는
패턴이며 쓰기 가능한 합성 뷰가 필요한 요구가 스펙에 없음).
