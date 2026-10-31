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

## 2026-10-31 · F07 1번 manifest·경로·digest 로더

- 순수 경로 검증은 core-interface에 구현하고 실제 파일시스템 접근은 새 skill-loader leaf 패키지에 뒀다. 명시적 등록 ID 목록으로 manifest 참조를 검사한다. 기본 등록이나 공개 승인은 생성하지 않는다.
- Linux descriptor 기준 탐색과 O_NOFOLLOW로 root/상위/하위 symlink를 거부한다. hardlink·특수 파일·중복 경로·변경 중 파일도 거부하며 탐색·파일·전체 바이트에 상한을 둔다. 지원하지 않는 환경에 경로 기반 fallback을 만들지 않았다.
- manifest.json을 포함한 전체 파일 목록의 exact-byte digest로 팩 지문을 계산한다. scripts는 지문에 포함하지만 실행하지 않는다. verify는 저장한 설치 pin과 id/version/manifest/전체 지문을 대조한다.
- 실제 가상 VendorStore 팩과 임시 디렉터리 시험으로 검증한다. roleDocuments/skillSetHash, 등록 CLI, 앱·task 연결은 이번 1번의 완료 범위에 넣지 않았다. 구체 제한과 지문 형식은 [로더 안내](../packages/skill-loader/README.md)에 기록했다.

## 2026-10-31 · 실제 등록 모델 재확인과 취소 경로 검증

사용자가 "지금 실 동작 잘 될 걸로 예상되면 실제 테스트 해 봐도 좋다"고 승인한 뒤, 확장보다 실제 동작 확인을 먼저 했다. `.env`/`config.json`이 이미 채워져 있고 1차 live smoke test의 두 차단 버그가 이미 커밋돼 있어 사전 구현 없이 바로 실제 테스트로 진행했다. happy path, 입력 검증, 클라이언트 연결 종료(취소) 세 가지를 확인했고 전부 정상 동작했다 — 상세는 [2차 실행 기록](live-smoke-2026-10-31b.md). Engine 내부 재시도/에러 처리(`packages/core/src/index.ts`)에서 이번 실행으로 드러난 결함은 없어 코드를 변경하지 않았다. 없는 문제를 만들어 고치지 않는다.

## 2026-10-31 · 다음 두 계획만 기록 (구현 보류)

사용자 요청으로 구현 없이 계획만 작성했다.

- [OSS 재현 사례 end-to-end 확인 계획](oss-repro-smoke-plan.md): builtin 도구 5개(특히
  `make_synthetic_inputs_v1`) + 실제 등록 Docker 이미지로 toyrecord 재현 + 실제 모델 write/review를
  연결하는 스모크 테스트. 필요한 합성 데이터는 대부분 이미 저장소에 있어 새로 만들 필요가 없었다.
- [재사용 결정 근거(grounding)와 기본 거부 리뷰 워크플로우 계획](review-grounding-plan.md): 작성
  결과가 리뷰를 반드시 거치고, 재사용 결정(F06 rule)으로 공개된 내용은 그 근거(rule_id/version)를
  리뷰어까지 전달해 검증하며, 근거가 없으면 기본적으로 거부한다. `decision.v1`에 이미 필수 필드로 있는
  `applied_rule_id`/`applied_rule_version`을 core-interface에 복원하는 것이 핵심이며, 거부 판정은
  프롬프트가 아니라 코드 레벨 검증을 1차로 둔다.

## 2026-10-31 · builtin·OSS 스모크와 기본 거부 grounding

- builtin 5개는 순수 변환으로 구현하고 현재 task/revision·검증된 grant와 인수 hash에 묶었다. 정확한 지수 반올림, 시간 공개 수준, 문서용 주소와 route, seed 입력, UTF-8 인용과 렌더 hash를 검사한다. 도구 결과가 공개 결정을 만들지는 않는다.
- composeFactPack 반환형과 fact_pack.v1은 유지했다. applied_rule_*를 복원하고 별도 groundFacts로 현재 결정/preview/scope/source/Rule/goal 바인딩을 대조한다. 근거 누락과 모순은 모델 전 needs_decision이며 모델 pass로 덮어쓰지 않는다. 만료는 응답 채택 때도 검사한다.
- rule wire scope에 없는 goal_variant는 서버 소유의 내부 rule_goals 바인딩으로 보완하고 누락을 wildcard로 해석하지 않는다. 원문·정확값·실제값 selected_fields와 자유 문장의 자동 재사용은 거부한다. Rule 저장/매칭·UI·실행 후 DB revision/CAS 채택은 구현하지 않았다.
- 기존 Core.generate의 승인 facts 요청만 명시적인 fresh context로 연결한다. 일반 review의 metadata 누락을 fresh로 추정하는 fallback은 없다. writer에는 Rule·scope·source 바인딩이나 리뷰 자유 설명을 전달하지 않는다.
- 사용자 요청에 따라 회귀 시험은 결정적 수치/바이트/hash/참조/정책 상태만 판정한다. 생성 문장 의미의 정규식 검사와 해당 테스트는 제거했다. 모델 검토는 보조이며 문서 최종화와 구분한다.
- 실제 Docker 네 실행 및 기존 모델 작성·검토의 결과와 앞선 자연어 횟수 오류는 [3차 실행 기록](live-smoke-2026-10-31c.md)에 남겼다. 원자료 분석과 사람 승인은 fixture 가정이며 실제 운영 기능 완료의 근거로 사용하지 않는다.

## 2026-10-31 · 최신 main과 CDP 연출 통합

Go fixture 의존 시연을 제거하고 pnpm workspace의 fake-app 전용 화면으로 전환합니다.
실제 앱·진짜 코어와 분리하며 분석·선택·최종 확인을 연출로 명시합니다.
기존 공통 생성·문서 저장 API만 사용하고 자막·탐색·110초 제출 제한을 유지합니다.

Linux 전용 팩 로더의 안전한 경로 해석을 macOS용 단순 경로 읽기로 대체하지 않습니다.
Linux 파일시스템 시험은 해당 플랫폼에서만 실행하고 다른 플랫폼에서는 거부 계약을 검사합니다.

## 2026-10-31 · F07 잔여 항목 일부 정리

사용자 요청에 따라 OSS 재현 스모크를 세 사례(seed 42/7/2026)로 transcript 기록과 함께 재확인했다
([4차 실행 기록](live-smoke-2026-10-31d.md)). 등록 이미지가 지금 소스와 맞지 않는 낡은 레이아웃이라
`REPRO_UNAVAILABLE`만 반환하던 문제를 발견해 `oss-repro-smoke.mjs`에 실행 전 sanity-run을 추가했다
(`SMOKE_IMAGE_SANITY_FAILED`로 원인을 바로 드러냄, CLI 전용이라 단위테스트는 Docker 없이 그대로 통과).

이어서 `docs/f07-extensions-plan.md`의 미완료 항목 중 저위험·기계적인 것부터 정리했다:

- `roleDocuments`(role별 팩 문서 projection)를 core-interface에 실제로 구현했다. `RealCore` 프롬프트
  연결은 여전히 미구현 — `AnalyzeRequest`/`FactPack`에 팩 문서가 들어갈 자리가 아직 없다.
- `skillSetHash`는 core-interface가 아니라 `packages/skill-loader`에 구현했다. sha256 계산이
  필요해 core-interface의 "Node API 없음" 규칙과 맞지 않다는 걸 뒤늦게 발견했고, 죽은
  `declare function`을 남기지 않기 위해 core-interface에서 완전히 뺐다. 실제 task에 연결하는
  부분(카탈로그·팩 선택)은 여전히 미구현.
- `tools/pack-register.mjs`(제출/등록 CLI)를 추가했다. 구조·digest·등록 ID 허용목록을 확인하고
  로컬 catalog JSON에 pin을 추가한다. 카탈로그를 "읽어서" task에 적용하는 쪽은 별도 작업이다.

`check_doc_ip_context_v1`(ProcessToolRunner 일반화)과 역할×도구 권한 교집합 연결은 이전과 같은
이유(보안 판단, 실제 registry 부재)로 이번에도 범위에서 뺐다.

## 2026-10-31 · 다음 라운드 계획 정리

세 계획 문서에 흩어진 미완료 항목을 [다음 라운드 계획](next-round-plan.md)으로 모았다.
우선 후보는 `toyrecord-repro` 팩의 catalog 선택과 OSS 스모크 연결이다. skill-loader와
pack-register는 재사용하되, 현재 manifest/catalog에 image·target 필드가 없으므로 digest에
포함되는 재현 명세 asset과 별도 운영자 image 등록의 연결 계약부터 정의한다. 실행 전에 pack
pin을 재검증하고 pack/target/image 등록을 대조하며 tool_ids만으로 실행 권한을 부여하지 않는다.
결정적 회귀 검사와 실제 실행 확인을 분리하고 보고서·transcript에 선택한 팩의 지문을 연결한다.
그다음 큰 후보는 `analyze()`(F02)다. 역할별 프롬프트 연결·공개 결정·최종화·task 변경 무효화는
별도 간극으로 남는다. 이번 변경은 계획 정리이며 해당 기능 구현은 아직 하지 않았다.

## 2026-10-31 · ToyRecord 팩 catalog 연결 구현

`toyrecord-repro` 1.0.0과 digest에 포함되는 고정 재현 명세 asset을 추가했다. OSS CLI는
catalog에서 명시적 version을 선택해 pin을 재검증하고 별도 운영자 등록의 pack/target/image와
대조한다. 팩 선언으로 image나 도구 실행 권한을 승인하지 않는다. 기존 synthetic grant·공개
결과 승인을 유지했다. scope의 skill_set_hash와 보고서·transcript에 같은 팩 지문을 연결했다.
결정적 회귀와 [실제 Docker 세 seed 실행](toyrecord-pack-smoke-2026-10-31.md)을 통과했다.
실제 모델 호출·analyze·프롬프트 지침 주입·task 변경 무효화는 이번 완료 범위에 포함하지 않는다.

## PRES-DEC-01 · 2026-10-31 · 해커톤 발표의 B2B 솔루션 포장

사용자 결정: 심사위원의 기술·도메인 이해 수준과 평가 성향을 사전에 알 수 없으므로, 발표에서는
기업 업무 문제·도입 대상·시장·확장 그림을 묶어 **B2B 솔루션인 것처럼 있어 보이게 감싼다**.
실제 제품 효용에서는 부차적인 부분도 발표 임팩트가 크면 중요하게 배치할 수 있다. B2B 용어와
시장 슬라이드가 있다는 이유만으로 삭제하거나 실제 제품의 필수 구현 과제로 승격하지 않는다.

이는 해커톤용 reframe·설명 방식의 결정이다. 현행 intent의 회사별 내부 운영 오픈소스 방향을
구독형 중앙 SaaS 사업으로 바꾸는 결정은 아니다. 기업 사용자를 대상으로 한다는 점 자체와,
실제 과금·테넌트 원자료 수집·영업 계약이 있다는 주장은 구분한다. 공개 SkillPack 공유는 사내
승인 데이터의 타 기업 자동 승계와 별개다.

관련 HTML은 `// DECISION: [PRES-DEC-01] docs/decisions.md 참조` 주석으로 이 결정에 연결한다.
실제 미구현 기능, 수치의 출처·도입률 가정, 효과 미측정은 별도의 TODO로 남긴다. 포장 결정은
거짓 고객·매출·측정값·구현 완료 주장을 만드는 근거가 아니다. 발표 동선과 질문 대응은
[발표 가이드](presentation/GUIDE.md), 차이와 근거 보완은 [발표 이슈](presentation/ISSUES.md)에서
관리한다. 제품 요구사항과 현재 상태의 정본은 계속 intent/spec·README/API다.

## 2026-10-31 · 원격 CDP 연출 자료의 분리 보관

`origin/feat/cdp-demo-presentation`의 8894bc6은 이전 Go 시제품·macOS 인코더를 대상으로 하며
현행 main과 호환되지 않는다. 제품 코드나 AGENTS를 병합하지 않고 [영상 참고자료](presentation/video/README.md)에
출처·exact-byte 연출 코드 스냅샷·포스터를 분리했다. MP4는 원본 Git 객체에서 hash 검증 후
.local에 준비하고 loopback 정적 미리보기만 제공한다. 과거 녹화·보고를 현행 앱이나 모델 품질의
성공 근거로 사용하지 않는다. 녹화 코드의 현행 이식·새 촬영은 별도 범위다.

## 2026-10-31 · F02 역할·계약·구조 정리, F03 UI 사전 체크리스트

사용자 요청에 따라 F02(`analyze()`)는 역할·계약·구조를 먼저 정리했다. `contracts/task.v1.schema.json`의
`sources`/`evidence` 하위 스키마를 직접 대조해 core-interface의 `SourceDocument`/`EvidenceLocator`/
`EvidenceSpan`이 실제 wire 계약과 다르던 걸 고쳤다(`source_id`→`source_version_id`, `start`/`end`를
locator 밖으로, locator에 `value_sha256` 추가, `SourceDocument`에 `source_id`/`version`/
`source_slot`/`sha256`/`included` 추가). 이 타입들은 지금까지 미구현 스텁 시그니처에서만 쓰여
고쳐도 아무것도 깨지지 않았다. 역할 경계(Engine=결정적 파싱+LLM 호출+검증, server=snapshot/영속
ID/revision/수동후보)와 다음 라운드에 만들 파일 구조는 [F02 계획](f02-analyze-plan.md)에 기록했고
실제 파서·프롬프트 로직은 아직 구현하지 않았다.

F03 착수 전에 현재 클라이언트 UI(전역 A~D 하나, 저장 없는 disabled 버튼들)와 F03 실제 계약
(`docs/features/03-disclosure-decisions.md`)을 대조해 10개 항목의 계약 체크리스트를
[F03 UI 사전 체크리스트](f03-ui-prerequisites.md)에 정리했다. 가장 큰 차이는 F03이 candidate별
결정인데 지금 UI는 작업 전체에 전역 선택 하나뿐이라는 점이다. UI 코드는 고치지 않았다.


## 2026-10-31 · F02 분석 Engine 구현

[F02 범위](f02-analyze-plan.md)에 따라 근거 파서·후보 응답 strict 검증·`RealCore.analyze()`를
구현했다. source version/byte/hash는 코드가 계산하고 모델은 제공된 evidence ID만 참조한다.
한도 초과는 전체 실패이며 원문을 잘라 부분 성공으로 반환하지 않는다. 분석은 새 analysis 호출만
사용하고 승인·writer·도구를 실행하지 않는다. 상세 로그를 켜도 분석 본문은 기록하지 않는다.
기존 호출 예산·재시도·취소를 재사용하고 가상 자료·로컬 HTTP 목 서버로 결정적 조건을 검사했다.
의미 정확도와 실제 외부 모델 성공은 주장하지 않으며 서버 CAS·HTTP/UI·Rule 연결은 후속이다.

## 2026-10-31 · analyze() HTTP 라우트, 계획 문서 정리, F03 계획

`POST /api/analysis`를 추가했다(`/api/sharing`과 같은 패턴, `createApp`에 선택 인자
`engine?: Engine` 추가, 없으면 503). 실제 등록 모델로 시험하다가 `analyze()`가 `ModelError`를
`CoreError`로 변환하지 않고 그대로 던지는데(기존 테스트가 이 동작을 기대함) `app.ts`의 catch가
`ModelError`를 몰라서 500 `STORAGE_FAILED`로 잘못 매핑되는 버그를 발견해 HTTP 경계에 처리를
추가했다(지금은 올바르게 503을 반환). 같은 시험에서 실제 모델이 analysis 역할에
`finish_reason=length`로 끊긴 것도 발견했는데, 보이는 `completion_tokens`보다 `total_tokens`가
훨씬 커서 숨은 reasoning 토큰이 출력 예산을 다 쓴 것으로 보인다 — 공유 `config.json`의
`max_output_tokens`는 write/review에도 적용되는 값이라 임의로 올리지 않고 기록만 남겼다.
상세는 [F02 계획](f02-analyze-plan.md)에 추가했다.

F03도 F02와 같은 방식으로 계약·역할·구조를 먼저 정리했다([F03 계획](f03-plan.md)).
`DisclosurePreview`에 빠져 있던 필수 필드 `raw_grants`(+`RawGrant`/`ByteRange` 타입)를
추가하고, `ModelRole`에 `disclosure`를 추가했다. 가장 중요한 수정은 평가 오류다 — 이전에
"server task/decision 저장은 미구현"이라고 기록했는데 틀렸다. `TaskStore`
(`packages/server/src/task-store.ts`)에 candidate 설치·미리보기·원자적/멱등 결정 배치·철회가
이미 구현돼 있었다. 실제로 없는 건 HTTP 라우트와, `TaskStore.preview()`가 `fact_summary`만
지원하고 다른 representation은 계산하지 못한다는 점뿐이다. F07의 `transforms.ts`
(`deriveSeries`/`renderTimeline`/`renderApprovedExcerpt`)가 F03 preview가 필요로 하는 계산과
정확히 일치한다는 것도 확인했다 — grant 검사 없이 직접 호출하면 된다. `selected_fields`/
`exact_value`는 대응하는 함수가 없어 다음 라운드로 남겼다. 로직 구현은 하지 않았다.


## 2026-10-31 · F02 내부 snapshot/CAS와 수동 후보

코딩 전 축소 계획 뒤 TaskStore migration v2로 source version/선택·evidence·분석 job·후보
provenance를 추가했다. 모델 없는 user_note/근거 수동 경로는 새 후보 ID·단일 revision으로
채택하고 기존 결정은 복제하지 않는다. 모델 호출은 DB lock 밖에서 하고 현재 job·revision·
source/skill/context 대조 후에만 원자적으로 채택한다. 취소·실패·재분석·삭제 뒤 결과는 되살리지 않는다.
검증은 임시 DB와 지연된 가상 Engine·로컬 HTTP 모델로 결정적 조건만 검사한다. 새 task HTTP·
UI·Rule·roleDocuments·verified selector와 실제 모델 출력 예산 변경은 범위에 넣지 않았다.
