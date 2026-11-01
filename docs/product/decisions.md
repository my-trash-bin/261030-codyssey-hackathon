# SafeHandoff 아키텍처/설계 결정 기록 (ADR)

문서 버전: 2.0 / 기준일: 2026-10-31 / 상태: 현행 정본 (TypeScript 워크스페이스 기준) / 연결: [intent.md](../../intent.md), [prd.md](prd.md), [spec.md](../design/spec.md), [architecture.md](../design/architecture.md)

## 1. 결정 구분 원칙 (`U` / `D` / `Q`)

- **`U` (`U01-U12`)**: [intent.md](../../intent.md)에서 사용자가 확정한 제품 의도다. 임의로 축소하거나 변경하지 않는다.
- **`D` (`D01-D24`)**: 제품 요구사항을 일관되게 구현하기 위해 확정한 기술/도메인 결정이다.
- **`Q` (`Q-LLM`, `Q-POLICY`, `Q-EXT`, `Q-DEPLOY`, `Q-LICENSE`)**: 실제 도입 조직의 운영 환경에서 확인해야 할 사항이다. 미확인 상태에서도 로컬 가상 데이터와 고정 계약으로 검증 가능하게 설계한다.

---

## 2. 핵심 설계 결정 (`D01-D24`)

| ID | 결정 내용 | 선택한 이유 | 기각한 대안과 전환 기록 |
| --- | --- | --- | --- |
| `D01` | **런타임/언어 단일화**: TypeScript 5.8 + Node 24(`node:sqlite`, `node --test`) + React 19 + `pnpm` 9개 패키지 모노레포로 구현한다. (재현 대상 예시 바이너리 `toyrecord`만 컨테이너 내부 고정 Go 바이너리 유지) | 초기 Go 단일 바이너리 시제품을 폐기하고 TypeScript로 재작성해 JSON Schema(`contracts/*.schema.json`)/엔진 인터페이스(`core-interface`)/서버/React 클라이언트 간 타입 계약을 단일화했다. 외부 네이티브 DB 드라이버 없이 Node 24 내장 `node:sqlite`를 사용한다. | 초기 Go 서버 + 정적 바닐라 JS 시제품(프론트/에이전트 코어/스키마 타입 이중 관리 부담으로 전환), Python/FastAPI 혼합 스택 |
| `D02` | **단일 사용자 로컬 우선 실행**: 기본 `127.0.0.1` 바인딩과 로컬 세션 기반으로 동작하며, 조직 계정/다중 결재는 P2로 분리한다. | 해커톤 및 초기 PoC에서 핵심 가치(공개 수준 결정과 승인팩 기반 새 작성)에 집중하기 위함이다. | 멀티테넌트 SaaS, 사내 SSO 필수 연동 |
| `D03` | **원자료 불변 판본 저장**: 업로드/붙여넣기한 원자료는 정규화하지 않고 원본 UTF-8 바이트와 SHA-256 해시를 그대로 보존한다. | 근거 위치(UTF-8 byte range, CSV 행/열, JSON Pointer)와 승인 인용(`approved_excerpt`) 해시가 흔들리지 않아야 한다. | 입력 시 자동 마스킹 덮어쓰기, 줄바꿈 임의 변환 |
| `D04` | **역할별 입력 분리와 `FactPack` 경계**: 같은 사내 LLM을 쓰더라도 `Analyst`(원자료 읽기)와 `Writer`(승인된 `FactPack`만 읽기), `Reviewer`(초안/근거/승인 대조)의 입력 페이로드를 앱 코드가 엄격히 분리한다. | 모델에 원문을 주고 "비밀만 빼고 써라"라고 지시하면 미승인 맥락이 유출되기 쉽다. `Writer`에 원자료 자체를 주지 않는 것이 가장 확실한 입력 경계다 (`INV-04`). | 단일 프롬프트 요약/마스킹, 자유 대화형 에이전트 루프 |
| `D05` | **제한된 `DocAST`(`draft.v1`)와 슬롯 합성**: `Writer`는 `heading`, `paragraph`, `list`, `table_ref`, `excerpt_ref`, `asset_ref` 블록과 `fact_ids` 참조만 반환하고, 실제 표/원문 인용/공개 자산 바이트는 앱이 삽입한다. | 모델이 수치 표나 원문 인용을 다시 타이핑하면서 숫자를 바꾸거나 가림 구간(`[가림]`)을 깨뜨리는 일을 방지한다. | 자유 Markdown 문자열 직접 생성, HTML 직접 생성 |
| `D06` | **수치 시계열의 결정적 변환(`builtin-tools`)**: A 사실 요약, B 추이(`series_direction_only.v1`), C 선택 필드(`select_fields.v1`), D 상대지수(`series_index_base100.v1`, `BigInt` 분수 `HALF_UP` 반올림)를 순수 TypeScript 함수로 계산한다. | LLM 암산 오류 없이 `820/1160/1740 -> 100/141/212`, `820/780/1740 -> 기준/감소/증가`를 결정적으로 보장한다. | 모델이 표 계산까지 직접 수행, 자연어 조건을 SQL/정규식으로 즉석 실행 |
| `D07` | **통제된 검토 피드백(`review.v1`)과 기본 거부 Grounding**: `Reviewer`가 문제를 지적할 때 자유 텍스트 설명은 내부 UI에만 남기고, `Writer` 재작성에는 고정된 `reason_code`와 승인된 `fact_id`/`block_id`만 전달한다. | 리뷰어의 내부 설명에 포함된 원자료 단서가 재작성 프롬프트를 통해 `Writer`로 역유입되는 경로를 차단한다 (`INV-05`). | 리뷰어 코멘트 전문을 Writer 프롬프트에 그대로 주입 |
| `D08` | **`SkillPack` 정적 검증과 역할별 문서 분리**: 제품별 지침 팩은 `manifest.json`과 모든 파일의 SHA-256 지문을 고정하고, `O_NOFOLLOW` 디렉터리 탐색으로 심볼릭 링크/경로 이탈을 차단하며, `Writer`에는 `public-writing.md`만 허용한다. | 내부 조사 매뉴얼(`SKILL.md`, `analysis.md`)이 작성기로 넘어가거나 미검토 스크립트가 실행되는 것을 막는다. | 런타임 원격 스킬 다운로드, `SKILL.md` 전체를 모든 역할에 주입 |
| `D09` | **무인터넷 Docker 샌드박스 4회 재현과 고정 Oracle**: `DockerReproRunner`는 `--network=none`, `--read-only`, `--cap-drop=ALL`, 비루트 UID로 고정 이미지 digest만 실행하고, ASCII/한글 x buggy/fixed 4회 결과를 코드로 판정한다. | 원래 7글자 고객 문자열을 쓰지 않고도 새 6글자 합성 입력에서 목표 인코딩 오류(`E_ENCODE_SHORT_BUFFER`)가 재현되는지 안전하게 입증한다. | 호스트 셸 직접 실행, LLM이 재현 성공 여부를 자유 해석 |
| `D10` | **재사용 규칙(`Rule`)의 범위 고정과 정확값 재사용 금지**: `Rule`은 6개 scope 필드와 검증된 `selector`/등록 `transform_id`가 일치할 때만 새 자료에서 다시 계산한다. `exact_value`, `approved_excerpt`, 실제값 `selected_fields`는 재사용을 금지한다. | 지난번에 특정 요청 ID나 원문을 공개했다고 해서 다음 장애의 새 고객 ID/원문이 자동 공개되면 안 된다 (`INV-10`). | 임베딩 유사도 기반 자동 승인, 과거 초안 문장 복사 |
| `D11` | **Revision CAS와 Stale 무효화**: 입력/목표/공개 결정/지침 팩이 바뀌면 즉시 `revision`을 올리고 이전 초안과 내보내기를 `stale`로 전환한다. 늦게 도착한 이전 작업 결과는 CAS로 버린다. | 선택을 '사실만(A)'으로 낮췄는데 이전 '비율 표(D)' 파일이 다운로드되는 경쟁 상태를 원천 차단한다 (`INV-07`). | 마지막에 끝난 비동기 응답 덮어쓰기 |
| `D12` | **3자 비교 검증과 정직한 측정 분리** (2026-10-31 도구 제거, 아래 해당 날짜 항목 참고): 결정적 파이프라인 비교(직접 정규식 가림 vs 미검토 원문 AI vs SafeHandoff)와 사람 스톱워치 실험을 분리해 기록한다는 원칙 자체는 유지하되, 이를 구현했던 `tools/value-comparison.mjs`/`tools/effect-measure.mjs`와 `evaluation/`의 보고 산출물은 제거했다. | 코드로 즉시 재현/검증 가능한 보안/단서 보존 지표와 실제 사람 참여가 필요한 작업 시간 지표를 섞어 과장하지 않기 위함이다 (`INT-11`). | 미수행 상태로 방치하거나 LLM 자기채점 점수로 대체 |
| `D13` | **입력 한도와 문맥 예산 사전 검사**: 개별 파일 2 MiB, 작업당 10개/5 MiB, 모델 문맥 예산을 사전 확인하고 초과 시 앞부분만 잘라 완료로 위장하지 않는다. | 잘린 입력으로 분석 완료 배지를 띄우면 중요한 오류 근거나 비밀 항목이 누락된다. | 조용한 앞부분 절단(Silent Truncation) |
| `D14` | **모델 출력 Strict JSON 검증**: 알 수 없는 키, 중복 JSON 키, 스키마 불일치, 비정상 enum, UTF-8 경계 위반 참조를 모두 거부한다. | 작은 사내 모델의 형식 오류나 환각 참조가 승인 데이터로 섞이는 것을 막는다. | 느슨한 정규식 추출 및 누락 필드 임의 보정 |
| `D15` | **재현 목표(`goal_variant`)와 실행 상태 분리**: `reproduction_evidence`는 `reproduced`여야 완료되지만, `default`/`observations_only` 문의는 Docker 미설치(`not_run / no_environment`) 상태에서도 관찰 문의로 확정할 수 있다. | 재현 환경이 없는 B2B 공급사 문의까지 막히지 않게 하면서도, 재현 성공으로 허위 표시하지 않는다. | 모든 문의에 Docker 필수 강제, 또는 미실행을 성공으로 표시 |
| `D16` | **맥락 기반 IP 예외(`check_doc_ip_context_v1`)**: `make_config_example_v1`이 새로 생성한 설정 슬롯 안의 RFC 5737 문서용 대역(`192.0.2.0/24` 등)만 해당 finding에 한해 허용하고 원문 로그의 동일 IP는 허용하지 않는다. | 설명용 예시 설정은 공유 가능하게 하되 실제 접속 로그의 주소가 같은 예외로 빠져나가지 못하게 한다. | IP 정규식 일괄 차단 또는 특정 IP 문자열 전역 허용 |
| `D17` | **승인 인용(`approved_excerpt`)의 바이트 범위와 `[가림]` 고정 치환**: 원문 인용은 원본 판본 해시, UTF-8 문자 경계에 맞는 반열린 바이트 구간, 정렬/비중첩 `hidden_ranges`를 검증해 `[가림]`으로 치환한 결과 해시에 묶는다. | 모델에 원문 가림을 맡기지 않고 사용자가 눈으로 확인한 정확한 바이트만 삽입한다. | 모델 기반 자유 마스킹 인용 |
| `D18` | **내보내기 파일 Allowlist와 결정적 ZIP**: 공유 파일명은 목적별 고정 allowlist만 사용하고 원본 파일명/로컬 경로/시각을 제외한다. 다운로드 시 새 생성 없이 확정된 바이트를 그대로 반환한다. | 원본 파일명(`고객사_비밀로그.txt`)이나 작업 폴더의 내부 파일이 첨부에 섞이는 사고를 방지한다 (`INV-08`). | 작업 임시 폴더 전체 압축, 다운로드 시 재렌더링 |
| `D19` | **단일 모델 서버와 순차 호출(`max_concurrency=1`)**: 사내 단일 모델 환경을 고려해 역할별 호출을 순차 실행하고 단계당 재시도 2회, 수리 2회, 전체 12회 상한을 둔다. | 작은 사내 LLM 서버의 과부하와 무한 수정 루프를 방지한다. | 다중 에이전트 무제한 병렬 호출 |
| `D20` | **모델 장애 시 수동 복구(Human Fallback) 경로 보장**: 분석 실패 시 수동 후보 추가, 작성 실패 시 제한 편집, 검토 실패 시 `human-review` 기록을 제공하되 미승인 원문/만료/보안 finding 같은 hard gate는 우회하지 못한다. | 작은 모델이 실패해도 업무는 이어가되 보안/승인 불변조건은 그대로 유지한다 (`INV-11`). | '사람 확인' 체크박스 하나로 모든 검증 우회 |
| `D21` | **작업 삭제와 재사용 규칙(`Rule`) 수명 분리**: 작업 삭제 시 원자료/초안/결정/이력/임시 파일은 즉시 삭제하고, 원문을 담지 않는 재사용 변환 기준(`Rule`)은 원작업 참조만 해제해 보존한다. | 일회성 민감 원자료는 지우면서도 팀이 정한 안전한 표현 규칙까지 매번 잃지 않게 한다. | 삭제 시 규칙까지 강제 삭제하거나 규칙 안에 원문 보관 |
| `D22` | **실행 Transcript(`transcript.v1`) 기본 비활성 및 민감정보 제외**: `FileTranscriptSink`는 명시적으로 켰을 때만 JSONL을 기록하며, 내용 모드에서도 원자료/API 키/리뷰어 내부 설명은 기록하지 않고 24시간 뒤 정리한다. | 시연/디버깅 재현성을 확보하면서 디버그 로그가 제2의 원자료 유출 경로가 되지 않게 한다. | 모든 원문 프롬프트와 응답을 영구 로그로 저장 |
| `D23` | **외부 통신 차단과 설정 고정**: 모델 엔드포인트는 프로세스 시작 설정에서만 읽고 redirect를 따르지 않으며, 원자료나 모델 응답 안의 URL/도구 호출 명령으로 외부 요청을 발생시키지 않는다. | 프롬프트 인젝션을 통한 SSRF 및 데이터 외부 유출을 차단한다 (`INV-01`, `INV-02`). | 사용자 입력/모델 응답 기반 동적 웹 조회 허용 |
| `D24` | **시연 모드(`app` vs `fake-app`)와 Fixture 투명 표시**: 실제 코어/모델/SQLite를 쓰는 `@safehandoff/app`(`:8080`)과 UI 흐름 연출용 `@safehandoff/fake-app`(`:8081/__demo`)을 패키지 수준에서 분리하고, live 실패 시 fixture로 자동 대체하지 않는다. | 심사 시연의 안정성을 확보하면서도 연출 응답을 실제 모델 추론이나 보안 검증 완료로 속이지 않는다 (`INV-14`). | 실제 모델 호출 실패 시 조용히 하드코딩 응답 반환 |

---

## 3. 발표 패키지 관련 결정 (`PRES-DEC-01`)

- **`PRES-DEC-01` (해커톤 발표용 B2B 솔루션 프레이밍 유지)**:
  - 제품은 [intent.md](../../intent.md) `INT-04`/`INT-12`에 따라 내부 설치형 오픈소스 도구로 개발한다.
  - 다만 해커톤 발표 슬라이드에서는 다양한 배경의 심사위원이 기업 문제/도입 효과/시장 규모(TAM/SAM/SOM)를 직관적으로 이해할 수 있도록 B2B 엔터프라이즈 솔루션 프레이밍을 유지한다.
  - 발표 슬라이드의 가설/목업과 실제 코드 구현 범위의 차이는 숨기지 않고 [docs/presentation/ISSUES.md](../presentation/ISSUES.md) (`PRES-01-PRES-12`)에 명시적으로 대조/관리한다.

---

## 4. 구현 라운드별 아키텍처 진화 요약

1. **초기 설계 -> TypeScript 모노레포 전환 (`D01`)**:
   - 초기 Go 단일 앱 설계의 도메인 계약(`contracts/*.schema.json`, `contracts/schema.sql`, `F01-F10` 명세)을 그대로 보존하면서, 런타임을 TypeScript 9개 패키지로 재구축했다.
   - `@safehandoff/core-interface`는 외부 런타임/Node 내장 모듈 의존성이 전혀 없는 순수 타입/검증/투영 패키지로 고정했다.
2. **엔진 워크플로우 및 보안 하드닝 (`D04`, `D07`, `D09`)**:
   - `RealCore.analyze()`(근거 파서/후보 검증), `composeFactPack()`(공개 결정 투영), `groundFacts()`(재사용 규칙/만료/철회/범위 기본 거부 검증), `writeReviewed()`(1회 제한 수리 루프)를 구현했다.
   - `DockerReproRunner`는 심볼릭 링크 거부, 고정 이미지 digest 검증, `--network=none` + `--read-only` + `--cap-drop=ALL`, 64 KiB stdout/stderr 상한, 4회 실행 고정 oracle 판정을 구현하고 보안 검토를 통과했다.
3. **도메인 확장(`F07`) 및 종단간 재현 스모크(`F08`) (`D06`, `D08`, `D22`)**:
   - `packages/skill-loader`의 `FsSkillPackLoader.load()`/`verify()`, `tools/pack-register.mjs`, `packages/core/src/builtin-tools.ts` 5종 변환 도구, `FileTranscriptSink`(`transcript.v1`), `tools/oss-repro-smoke.mjs`를 연결해 실제 등록 모델 및 Docker 환경에서 종단간 재현/작성/검토 흐름을 검증했다.
4. **F02 분석 HTTP/내부 저장(`TaskStore.analysis`), F03 후보별 UI, CDP 연출 통합 (`D04`, `D11`, `D24`)**:
   - `POST /api/analysis`, `TaskStore.analysis`/`runTaskAnalysis`(source/evidence/job snapshot 및 revision CAS 채택), `provider.max_output_tokens: null`(숨은 reasoning 토큰 잘림 방지), 클라이언트 `analysis-view.ts`/`disclosure-view.ts`, `fake-app` 전용 CDP 연출(`/__presentation`, 99.988초 녹화 검증)을 통합했다.
5. **3자 가치 비교 실험 자동화 (`D12`)**:
   - `evaluation/effect-compare/cases.json` 10개 가상 사례(금지 항목 48개, 필수 단서 32개)에 대해 직접 정규식 가림 vs 미검토 원문 AI vs SafeHandoff를 결정적으로 비교하는 `tools/value-comparison.mjs` 및 자동 테스트를 구축해 `INT-11`과 `PRD-13`의 비교 근거를 확보했다.

---

## UI-API-01 / task HTTP와 공개 결정 개발 경계

UI 요청에 따라 기존 내부 TaskStore를 v1 HTTP로 노출한다. 운영자 비밀로 여는 세션은
HTTP loopback/단일 운영자용이고 명시적 설정이 없으면 비활성이다. 세션/CSRF/Host/Origin/
revision/SQLite 멱등 기록을 함께 검사한다. 기존 stateless API의 인증을 대신하지 않는다.
원자료는 서버 snapshot으로 고정하고 서버 분석 job만 CAS 채택한다. 브라우저 AnalyzeResult를
받아 후보나 허용 결정을 만들지 않는다. C는 연결된 단일 CSV/JSON 근거 필드만 계산한다.
D 모델 응답도 제안이며 실제 미리보기와 사람 결정은 별도다. Rule 저장과 원문 예외/타임라인은
미지원으로 거부한다. 현재 서버 DTO는 [API](../design/api.md), 남은 화면 작업은 [요청 현황](../ops/ui-api-requests.md)을 따른다.

## 2026-10-31 / 두 신뢰 경계를 하나로 묶음

`docs/ui-api-requests-2.md`(이후 통합 삭제) 점검 중 실제 코드를 읽어 확인한 간극이다.
워크플로우 세션(`/api/v1/*`)이 세션/CSRF/Host/Origin 검사를 갖춘 뒤에도, 원자료를 실제
모델에 보내는 `/api/analysis`와 외부 공개 문서를 만드는 `/api/sharing`, 그리고
`/api/documents`는 아무 검사 없이 그대로 열려 있었다. `docs/api.md`에는 "이 설정이 기존
세 경로의 인증을 대신하지 않는다"고 적혀 있었는데, 이걸 의도된 설계로 해석하지 않았다 -
F10(`docs/features/10-runtime-boundary.md`)의 전체 취지가 원자료/모델 호출 경로를 막는
것이라, 더 민감한 경로가 더 약한 경로보다 느슨한 채로 남는 건 누락으로 보는 게 맞다는
판단으로 수정했다.

`packages/server/src/app.ts`에 `GUARDED_PATHS`(`/api/sharing`, `/api/analysis`,
`/api/documents`)를 추가하고, `createApp`의 새 선택 인자 `sessions?: WorkflowSessions`가
있으면 이 세 경로에 `sessions.require()`를 그대로 적용한다(`/health`, `/api/core`는 원자료나
모델 출력을 반환하지 않아 대상에서 뺐다). `WorkflowHTTPError`도 catch에서 처리한다.
`createWorkflowHandler`가 더는 내부에서 `WorkflowSessions`를 새로 만들지 않고 호출자가
주입한 인스턴스를 받게 고쳤다(기존 호출자는 기본값으로 그대로 동작, 하위 호환 유지).
`packages/app/src/main.ts`가 `WorkflowSessions`를 한 번만 만들어 `createWorkflowHandler`와
`createApp` 양쪽에 **같은** 인스턴스를 넘긴다 - 따로 만들면 `POST /api/v1/session`으로 연
세션을 legacy 경로가 못 알아본다. `docs/api.md`의 해당 문장도 새 동작에 맞게 고쳤다.

재발 방지로 `packages/server/src/core.test.ts`에 "legacy routes share the session boundary
once an operator enables it" 테스트를 추가했다 - sessions를 주입한 뒤 쿠키/CSRF 없이
`/api/sharing`을 치면 401, Origin만 맞고 CSRF가 없으면 403, 둘 다 맞으면 200, `/api/documents`도
같은 패턴, `/health`/`/api/core`는 그대로 열려 있는지까지 한 테스트에서 확인한다. 코드
쪽에는 이 테스트와 `docs/decisions.md`의 이 항목을 가리키는 주석을 남겼다(`app.ts`의
`GUARDED_PATHS` 주석, `workflow-http.ts`의 `createWorkflowHandler` 주석) - 다음에 누가 세
경로 중 하나를 바꾸거나 세션 공유를 깨면 주석이 먼저 그 테스트와 이 결정을 보라고 가리킨다.

## 2026-10-31 / QG 문자 예외 제거

사용자 승인에 따라 문서의 비 ASCII 문장 기호를 ASCII 기호로 일괄 치환했다.
`intent.md`도 기호만 치환하도록 별도 승인받았으며 제품 의도와 변경 승인 규칙은 유지한다.
문자 예외 목록은 제거하고 QG pre-commit 훅을 설치 및 자동 갱신하도록 설정했다.

## 2026-10-31 / 모델 SDK와 결과 인자 복구

사용자 승인에 따라 OpenAI 호환 전송을 Vercel AI SDK로 전환하고 분석/작성/검토 결과에
`@typia/vercel`의 결과 제출 도구를 적용했다. 외부 작업 도구나 공개 승인 기능을 추가하지 않는다.
SDK 중립 스키마를 typia 런타임 API로 검증하고 기존 Engine의 근거/참조 검사를 유지한다.
복구용 추가 모델 호출은 단계/전체 예산을 공유하고, 텍스트 대체나 숨은 재시도는 허용하지 않는다.
공개 조건 해석과 provider 확인은 기존 텍스트 계약을 유지한다. 실제 모델의 도구 지원과 출력
품질은 로컬 목 서버 검사와 구분하며, 이번 변경에서 외부 모델을 호출하지 않았다.

## 2026-10-31 / 3자 비교 실험 도구와 해커톤 보고 산출물 제거

사용자 승인에 따라 `tools/value-comparison.mjs`/`tools/effect-measure.mjs`(및 각 테스트),
`docs/presentation/effect-evidence.mjs`, `docs/검증보고서.md`, `evaluation/`(과거 Go 재현
기록 포함)을 저장소에서 제거했다. 해커톤 심사용 "증거 보고" 자체가 더 이상 필요한 산출물이
아니라는 판단이다. `D12`가 가리키던 "정직한 측정 분리" 원칙은 `intent.md`의 `INT-11`에 그대로
남아 있으며, 이 제거는 그 원칙을 평가자가 로컬에서 수행할 과제로 되돌린 것이지 원칙 자체를
철회한 것은 아니다.

`evaluation/expected/`/`evaluation/heldout/`은 평가자 전용 정답표/held-out 변형이라는 성격이
보고 산출물과 다르므로 삭제 대신 `fixtures/reference-pack/evaluator/`로 옮겨 접근 제외 목록을
유지했다(`fixtures/reference-pack/recipient/`와 같은 패턴). `docs/acceptance-map.csv`의
`AC-F02-05`/`AC-F04-01`/`AC-F10-05`와 `docs/traceability.csv`의 `T60`은 유일한 근거였던
`tools/value-comparison.test.mjs`가 사라졌으므로 `not_run`/`backlog`로 되돌렸다 - 다른 테스트가
같은 수준의 writer 입력 캡처를 아직 대신하지 않는다.

## 2026-10-31 / 제출 상태 스냅샷 작성과 AGENTS.md 서술 정정

"지금 최종 제출한다고 가정" 하고 개발 진척도를 점검하라는 요청에 따라, `pnpm build`/`pnpm test`/
`just check`/`tools/validate_docs.py` 네 가지를 이번 기준일에 다시 실행해 모두 통과를 직접 확인하고
[docs/product/submission-status.md](submission-status.md)에 그 결과와 127개 AC 현황, 심사자에게
밝혀야 할 제한(`not_claimed`, `product_backlog` 65개, ISSUES.md 포장/가설 구분)을 한곳에 모았다.
기존 [plan.md](plan.md)/[ISSUES.md](../presentation/ISSUES.md)/`validation-report.json`이 이미
각자의 범위에서 진척도를 추적하고 있었으므로 그 내용을 다시 만들지 않고 참조만 모았다.

점검 과정에서 `AGENTS.md`의 "진짜 코어는 아직 미구현이다"라는 문장이 초기 워크스페이스 분리
시점 이후 갱신되지 않은 채 남아 있던 것을 발견했다. 그 뒤 `RealCore.analyze()`/`write()`/
`review()`/Docker 재현 연결이 자동 테스트와 함께 구현됐으므로 이는 실제로 구현된 범위를
과소 서술하는 간극이었다 - 구현되지 않은 것을 완료로 보고하지 말라는 `AGENTS.md`의 원칙은
구현된 것을 미구현으로 보고하지 말라는 방향에도 같게 적용된다고 판단해 해당 문장을 현재 코드와
`product_backlog` 구분에 맞게 고쳤다. `intent.md`는 손대지 않았다.

## 2026-11-01 시작 토큰 제거

사용자 요청에 따라 시작 토큰 인증, 5분/1회 사용 제한, 토큰 접속 링크와 로그인 화면을 제거했다.
일반 접속 URL에서 작업 공간 연결을 자동 준비한다. 내부 세션 쿠키와 CSRF/정확한 Host·Origin 검사는
요청 무결성을 위해 유지하며 사용자 인증으로 설명하지 않는다. 내부 세션 만료·재시작 뒤에도 자동 재연결한다.
`SAFEHANDOFF_WORKFLOW_TOKEN`은 더 이상 사용하지 않는다. `intent.md`는 변경하지 않았다.
