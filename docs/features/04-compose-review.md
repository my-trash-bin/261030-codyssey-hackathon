# F04 / 승인 정보로 새 작성과 작성 중 검토

우선순위 P0 / 담당 역할: 워크플로우/도구 / 상태: 구현 명세 초안. 관련 [spec](../design/spec.md), [agent-workflow](../design/agent-workflow.md), [architecture](../design/architecture.md).

## 1. 목적

사용자가 고른 공개 수준에 맞는 새 본문/표/설명을 만들고 작성 도중 검토/수정/질문을 연결한다. 사용자가 여러 파일을 손으로 맞추는 수고를 줄인다. PRD-06/07/08/11/13, INV-04/05/06/07/08/11/14/15가 핵심이다.

## 2. 쓰는 사람과 권한

사용자가 작성/재시도/취소/직접 편집/사람 의미 검토를 요청한다. writer는 승인팩과 등록 공개 양식만 읽는다. reviewer는 내부 근거도 볼 수 있으나 자유 설명을 writer에게 전달하지 못한다. 모델과 등록 도구는 공개 허용을 늘리거나 최종 확인을 대신하지 않는다.

사람 의미 검토는 의미 단계만 대체한다. 판본/미승인 원문/깨진 참조/필수검사/미결정 오류는 계속 차단된다. '사람이 봤음' 한 번으로 모든 검사를 해제하는 플래그는 만들지 않는다.

## 3. 화면

UI-03의 초안 영역과 단계 표시, UI-04의 중간 질문, UI-06 최종 확인으로 이어진다. 초안에 연결된 공개 선택과 내부 근거는 별도 패널이다.

| 상황 | 사용자에게 보여줄 결과 |
| --- | --- |
| 공개할 내용 없음 | 빈 성공 대신 추가 자료/선택/목표 변경 |
| 작성 중 | 단계/취소/선택 변경, 아직 확정 아님 |
| 검토가 더 필요한 내용 발견 | 왜 필요한지, 최소 공개 대안, 제외/보류/직접 입력 |
| 선택 변경 | 이전 결과를 즉시 오래된 상태로 표시, 새 결과 작성, 복사/다운로드 차단 |
| 직접 편집 | 새 판본/재검토 필요, 원래 선택 변경 아님 |
| 형식/의미 실패 | 정해진 재시도 후 오류와 수동 경로 |
| 모델 검토 실패 | 실제 현재 파일과 미해결 항목, 사람 의미 검토 여부 기록 |
| 재현 미수행 | 관찰 문의인지 재현 증거 목표인지 구분해 다음 행동 안내 |

## 4. 데이터

읽기: tasks/current candidates/current decisions/rules, task/job snapshot, source/evidence(분석/검토만), 등록 public template, tool registry.

쓰기: fact_packs, jobs, artifacts, artifact_files, reviews, findings, tool_runs, events, 제한된 run_traces. 새 공개 선택은 직접 쓰지 않고 F03을 호출한다. 원문은 writer_payload_json에 포함하지 않고 internal_mapping_json에만 연결한다.

승인팩은 같은 revision에서도 도구 실행 결과를 반영한 새 불변 ID로 만들 수 있다. artifact는 fact_pack ID를 정확히 가리킨다. 예전 검토를 새 팩/새 파일에 가져오지 않는다.

## 5. 규칙/상태/동시성

### 5.1 작성 전

현재 scope/source/결정/기준/확장 판본을 재검증하고 job snapshot을 만든다. 승인팩을 앱이 구성한다. task snapshot은 revision 생성 시점 기록이므로 그것만으로 현재 권한을 판단하지 않는다. 보류를 제외한 임시 초안은 가능하지만 최종 확정은 막는다.

작성 전 필수조건과 최종 필수조건을 구분한다. reproduction_result는 실행 후 생기는 최종 조건이다. 허용한 target/합성 입력/출력 schema 범위에서 실행한 결과는 지정 필드만 팩으로 투영한다. 원시 stderr나 임의 새 업무 사실은 포함하지 않는다.

### 5.2 반복 흐름

1. writer에 승인팩으로 DocAST를 요청한다.
2. 구조/ID/참조/required fact 누락을 검사한다.
3. 작성 중 reviewer가 의미/누락/미확인을 검토한다.
4. 승인 사실만으로 고칠 수 있으면 fixed reason code와 유효 fact ID로 다시 작성한다. 문제 자유문장과 원문 설명은 전달하지 않는다.
5. 새 공개 결정이 필요하면 needs_decisions로 돌아간다. 기존 초안은 draft다.
6. DocAST/허용 슬롯으로 실제 파일 생성, 후처리 및 예외 반영, 파일 검사, 최종 의미 검토를 수행한다.
7. 모든 조건이 충족되면 artifact=ready, task=ready_to_finalize다.

모델 호출 단계당2회, 수정2회, 전체12회 중 먼저 도달한 상한에서 needs_attention으로 멈춘다. 네트워크 대기/재시도 중 UI 저장을 막지 않는다. 동작 지연값은 설정에서 바꿀 수 있지만 기록한다.

### 5.3 직접 편집

DocAST의 허용 text/list/slot만 편집한다. raw HTML이나 임의 첨부 경로는 받지 않는다. 새 수치/ID/사실이 있으면 추가 후보/결정 또는 삭제가 필요하다. fact ID만 붙여 미승인 정보를 승인한 것으로 만들 수 없다. 직접 편집이 의미 추가인지 완벽히 자동 판별한다고 약속하지 않고 의미 검토를 거친다.

직접 편집/선택 변경은 새 revision과 stale 처리를 먼저 한다. 자동 수정은 같은 revision의 artifact_version을 올린다. ready/finalized 이후 다시 작성은 새 revision이다. 전체 재작성으로 수동 문구가 바뀔 수 있음을 화면에 표시하고 이전 판본을 이력에 남긴다.

### 5.4 오류/복구

한 번에 current_job_id 하나, 모델 전체 동시성1. 재시작 queued/running은 모두 failed/INTERRUPTED다. 모델 timeout 후 취소가 실패해도 CAS가 늦은 결과를 거부한다. 최종 파일 생성 중 일부만 성공했으면 전체 bundle을 ready로 표시하지 않는다. 이전 정상 파일에 새 실패 결과를 섞지 않는다.

## 6. 다른 조각과 닿는 곳

| 연결 | 함수/API | 주고받는 데이터 |
| --- | --- | --- |
| F03 -> 작성 | `FactPackService.Build` | 현재 유효 결정/scope -> writer_payload + internal mapping |
| 작성 시작 | `CompositionService.Start` / POST tasks/{id}/jobs kind=compose | expected_revision, provisional flag -> job |
| 검토 시작 | `ReviewService.Start` / POST tasks/{id}/jobs kind=review | expected_revision, artifact ID, target kind/hash |
| 직접 편집 | `CompositionService.Edit` / PUT artifacts/{id}/edit | expected_revision, expected_document_hash, draft.v1 |
| 사람 검토 | `ReviewService.RecordHumanReview` / POST artifacts/{id}/human-review | expected_revision, target kind/hash, checklist, fallback reason |
| F07/F08 도구 | `ToolService.RunRegistered` | tool ID/version + 승인 참조 + typed args -> public projection/내부 진단 |
| F05 파일 | `BundleService.RenderAndCheck` | DocAST + 슬롯 -> immutable files/hash/findings/review |
| F09 진행 | jobs/events | 단계/실패/추가 질문/artifact 갱신 이벤트 |

함수명은 공통 서비스 경계이며 담당자별 별도 승인팩 생성 로직을 만들지 않는다. API 필드 이름은 api.md를 따른다.

## 7. 하지 않을 것

원문 전체를 writer에 주고 특정 내용만 지우게 하기, 검토 자유 설명을 새 writer prompt로 이어 붙이기, 모델에게 shell/SQL/외부 전송을 맡기기, 검토기 다수결을 보안 증명으로 표현하기, fixture를 live로 표시하기, 파일 생성 뒤 다운로드 시 재작성하기는 하지 않는다.

## 8. 끝났다는 기준

| ID | 확인할 결과 |
| --- | --- |
| AC-F04-01 | 실제 writer 요청에 승인팩/공개 지침만 있고 원자료/파일명/내부 설명/stderr가 없음 |
| AC-F04-02 | 작성 도중 reviewer가 들어오며 새 선택이 필요하면 UI 질문으로 돌아감 |
| AC-F04-03 | needs_changes는 승인 fact ID와 fixed code만으로 복구하고 원문 자유 설명을 전달하지 않음 |
| AC-F04-04 | 잘못된 causality/unknown 누락/필수 제약 삭제를 의미 검토와 사람 평가에서 확인 |
| AC-F04-05 | A/B/C/D 변경 뒤 본문/표/첨부 모두 새 선택과 일치하고 이전판본 복사 차단 |
| AC-F04-06 | 중복/미지 키/참조/truncation/예산 초과가 ready로 처리되지 않음 |
| AC-F04-07 | 같은 revision의 교체된 job 또는 다른 revision의 지연 응답은 적용되지 않음 |
| AC-F04-08 | 편집은 새 revision/검토이며 새 사실 공개 허용을 자동 생성하지 않음 |
| AC-F04-09 | 인간 의미 검토는 mode=human으로 표시하고 hard gate 우회 불가 |
| AC-F04-10 | 자동 검토/변환 뒤 한 바이트라도 바뀌면 대상 hash 검토를 다시 요구 |
| AC-F04-11 | default 관찰 문의는 재현 환경 없이 완료할 수 있으나 재현 성공이라고 쓰지 않음 |
| AC-F04-12 | reproduction_evidence는 실행 전 결과누락으로 순환 차단되지 않고 최종 단계에서 reproduced를 요구 |
| AC-F04-13 | 모델 실패/재시작/취소 때 선택과 이력 유지, fixture 대체 없음 |
| AC-F04-14 | 전체 파일생성 실패 시 일부 파일만 ready로 표시하지 않고 오류/재시도 안내 |
| AC-F04-15 | 새 도구 결과를 투영할 때 승인한 결과schema/field범위 밖 자유 stdout/stderr는 팩에 들어가지 않음 |

관련 QA: T01-T03, T08-T10, T15-T18, T20, T22-T24, T32-T35, T38-T40, T51, T56, T59. 개별 연결은 [acceptance-map.csv](../qa/acceptance-map.csv).

## 9. 확인 필요

Q-LLM: 실제 응답 능력/문맥 한도/보관 정책. 작은 모델로도 구현할 수 있지만 자율 완료 수준은 실제 평가 결과로 판단한다. Q-POLICY: 실자료에서 사람 의미 검토를 수행할 권한/책임자. synthetic PoC에서는 로컬 소유 사용자 역할로 개발한다.

## 10. 구현 순서와 영향

팩 구성 -> fixture writer -> DocAST validation/renderer -> reviewer 통제 피드백 -> 질문 복귀 -> 최종 bundle검사 -> 수동 편집/fallback -> live. 팩/초안 schema나 feedback 형식 변경은 F02/F03/F05/F07/F08, ERD/API/contracts와 QA에 반영한다.
