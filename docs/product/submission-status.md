# 제출 상태 요약

문서 버전: 1.0 / 기준일: 2026-10-31 / 상태: **지금 최종 제출한다고 가정했을 때의 현재 상태 스냅샷**. 구현 범위 자체의 정본은
[plan.md](plan.md)/[acceptance-map.csv](../qa/traceability.csv)이며, 이 문서는 제출 시점에 자동 검증을 다시 돌려 확인한 결과와
심사자에게 그대로 밝혀야 할 제한을 한곳에 모은다. 연결: [plan.md](plan.md), [decisions.md](decisions.md),
[ISSUES.md](../presentation/ISSUES.md), [qa.md](../qa/qa.md), [intent.md](../../intent.md) (`INT-11`).

## 1. 자동 검증 결과 (2026-10-31 기준일 직접 재실행)

| 검사 | 명령 | 결과 |
| --- | --- | --- |
| 빌드 | `mise exec -- pnpm build` | 10개 패키지 전체 통과 |
| 테스트 | `mise exec -- pnpm test` | 전체 패키지 `fail 0` (server 28, model-adapter 16, skill-loader 15, app 22, fake-app 4, `tools/*.test.mjs` 17 중 16 pass/1 skip) |
| 품질 게이트 | `just check` (QG recommended + typecheck + build + test) | `PASS` (오류 없음, 파일 줄수 경고만 존재) |
| 문서 무결성 | `mise exec -- python tools/validate_docs.py` | `status: passed`, 저장소에 커밋된 [validation-report.json](../../validation-report.json)과 동일한 결과 재현 (문서 재배치 이후에도 간극 없음) |

네 가지 모두 지금 그대로 제출해도 통과하는 상태다. 이 결과를 과거 실행 기록이 아니라 이번에 다시 돌려 확인했다.

## 2. 127개 수용 기준(AC) 현황

[validation-report.json](../../validation-report.json)/[plan.md 1.2절](plan.md)/[acceptance-map.csv](../qa/acceptance-map.csv) 기준.

| 구분 | 설명 | AC 수 | 자동 테스트 상태 |
| --- | --- | --- | --- |
| `hackathon_core` | 해커톤 핵심 수직 슬라이스(`H1-H2`) | 44 | 전부 자동 테스트 연결 |
| `hackathon_ext` | 도메인 확장/합성 재현(`H3`) | 18 | 전부 자동 테스트 연결 |
| `product_backlog` | 코어 계약/스키마는 준비됐지만 전체 REST 라우트/다중 화면/세션 연결이 남은 해커톤 이후 범위 | 65 | 대부분 `not_run` |
| **합계** | | **127** | 전체 `passed` 46 / `partial` 13 / `not_run` 68 |

QA 시험(`T01-T60`, [qa.md](../qa/qa.md))은 `passed` 13 / `partial` 33 / `not_run` 14다. `partial`은 계약/상태 자동 시험은
통과했으나 사람의 의미 판정(승인 사실 유지, 불필요 정보 포함 여부)이 아직 남은 항목이다.

## 3. 지금 그대로 심사자에게 보여줄 수 있는 것

- `just app` + `just client`: `packages/app`이 `configuredCore()`로 **실제 `@safehandoff/core`의 `RealCore`**를 조립한다
  (`packages/app/src/config.ts`). 저장소 루트 `.env`에 `SAFEHANDOFF_LLM_BASE_URL`/`MODEL`/`API_KEY`가 모두 채워져 있어
  모델 호출이 즉시 가능한 상태다. `fake-app`(연출용 가짜 코어, `:8081`)과는 패키지 수준에서 분리되어 있다.
  단, `config.json`의 `reproduction.enabled: true`에 대응하는 `SAFEHANDOFF_REPRO_REGISTRY`가 `.env`에 없어 Docker 합성
  재현 기능만 호출 시 `CORE_NOT_IMPLEMENTED`로 막힌다 - 재현 데모가 필요하면 그 값을 채워야 한다.
- 제출 영상(`docs/demo-media/SafeHandoff-demo.mp4`, 약 40MB)과 통합 발표자료(`docs/presentation/SafeHandoff_발표자료_통합.pdf`)
  모두 저장소에 존재하고 README에서 바로 링크된다.
- `pnpm test`/`just check`/`validate_docs.py` 세 검사가 모두 녹색이라 "코드와 문서가 서로 거짓말하지 않는" 상태로 제출 가능하다.

## 4. 심사자에게 먼저 밝혀야 할 제한

[validation-report.json](../../validation-report.json)의 `not_claimed` 목록과 [ISSUES.md](../presentation/ISSUES.md)를 그대로 따른다.

- **성과로 말하지 않는 것**: JSON Schema 엔진 검증 완결, 실제 LLM 품질, OS/컨테이너 격리 보장, 제품 수준 보안 보장, 사람 스톱워치 작업시간 절감.
- **제거된 산출물**: 해커톤 당시의 3자 가치 비교 도구(`tools/value-comparison.mjs` 등)와 `docs/검증보고서.md`, `evaluation/` 실행
  기록은 2026-10-31에 저장소에서 제거했다([decisions.md](decisions.md) 최하단 항목). `INT-11`의 "정직한 측정 분리" 원칙 자체는
  유지하되, 수치 비교는 평가자가 로컬에서 재실행해야 하는 과제로 남아 있다.
- **아직 화면/API로 연결되지 않은 부분(`product_backlog`, 65개 AC)**: 전체 `/api/v1/tasks` REST 라우트, UI-02~UI-10 다중 화면,
  `rules` CRUD API, ZIP 아카이브 다운로드 API 등. 코어 계약과 DB 스키마는 준비되어 있지만 end-to-end 화면 연결은 없다.
  [PRES-02](../presentation/ISSUES.md)가 "팀원 담당 영역 표기를 전체 완료의 증거로 쓰지 않는다"는 원칙을 명시한다.
- **발표 vs 코드 표현 차이**: 보안 "Zero 보장"류 문구, B2B 과금 포장, 시장 규모 추정치는 모두 ISSUES.md의
  PRES-05/07/08/09에서 가설/발표 포장으로 명확히 구분되어 있다. 제출 시 이 구분을 지워서 발표하지 않는다.

## 5. 이번에 발견하고 고친 문서 간극

`AGENTS.md`의 "진짜 코어는 아직 미구현이다"라는 문장은 초기 워크스페이스 분리 시점(`refactor: separate app and fake-app behind
shared core interface`)에 작성된 뒤 갱신되지 않은 채로 남아 있었다. 그 뒤 `RealCore.analyze()`/`write()`/`review()`/Docker 재현
연결이 자동 테스트와 함께 실제로 구현됐으므로(1-2절), 현재 코드와 맞지 않는 과거 진술이었다. 코드가 구현된 사실을 과장하는 방향이
아니라, 실제로 구현되고 테스트까지 통과한 부분을 "미구현"으로 과소 서술하고 있었던 쪽이라 `AGENTS.md`를 사실에 맞게 갱신했다
(어떤 범위가 실제로 남았는지는 여전히 `product_backlog` 65개 AC로 구분해서 과장하지 않는다).

## 6. 제출 직전 체크리스트

- [x] `pnpm build` / `pnpm test` / `just check` / `validate_docs.py` 네 가지 모두 이번 기준일에 재실행해 통과 확인.
- [x] 제출 영상/발표자료 파일이 저장소에 실제로 존재.
- [x] README의 "한눈에 보는 정본 문서" 표에 이 문서를 추가해 접근 경로 확보.
- [x] `AGENTS.md`의 실제 코어 구현 상태 서술을 현재 코드에 맞게 갱신.
- [ ] Docker 합성 재현 데모까지 보여주려면 `.env`에 `SAFEHANDOFF_REPRO_REGISTRY`를 채워야 함 (3절) - 제출 전 필요 시 확인.
- [ ] 시장 규모/효과 수치, B2B 포장 표현을 발표할 때 ISSUES.md의 가설/포장 구분을 함께 전달할 것 (4절).
