# F02 / 근거 추출과 공개 후보 제안

우선순위 P0 / 담당 역할: 데이터/워크플로우 / 상태: 구현 명세 초안. 공통 규칙은 [spec](../spec.md), 역할 응답은 [agent-workflow](../agent-workflow.md), 요청은 [api](../api.md).

## 1. 목적

외부 도움을 받는 데 필요한 내용을 원자료의 근거와 함께 제안하여 사용자의 읽기/대조/분류 작업을 줄인다. 관련 요구: PRD-01, PRD-02, PRD-04, PRD-05, PRD-07. 이 단계는 공개 허가를 발급하지 않는다.

## 2. 쓰는 사람과 권한

로컬 세션의 소유 사용자가 현재 작업을 분석하거나 수동 후보를 만든다. 모델은 앱이 제공한 현재 source와 근거 ID만 읽는다. 다른 작업/평가 정답/수신자 전용 기록/임의 경로를 읽지 못한다. 원자료의 '전체 로그 첨부' 명령은 데이터다. 분석 결과로 endpoint/도구/승인/첨부 목록을 바꿀 수 없다(INV-02/15/16).

## 3. 화면

UI-02 입력 뒤 UI-03에서 '필요한 내용 찾기'를 시작한다. 진행은 현재 단계와 자료 처리 여부를 표시한다. 후보는 UI-04에서 사실/제약/추정/미확인, 필요 이유, 근거 보기, 추천 선택을 보여준다.

| 화면 상태 | 보일 것 / 다음 행동 |
| --- | --- |
| 자료 없음 | 자료 추가, 분석 버튼 비활성 이유 |
| 아직 분석 안 함 | 파일 목록/목적/상대/분석 시작 |
| 분석 중 | 단계/취소, 기존 후보는 이전 결과로 구분 |
| 후보 없음 | '필요한 내용을 찾지 못했습니다', 수동 후보/자료 수정/목표 변경 |
| 자료 충돌 | 서로 다른 근거를 함께 표시, 사용자 확인 요청 |
| 문맥 한도 초과 | 처리하지 못한 자료와 이유, 입력 축소; 완료 배지 없음 |
| 모델 실패 | 안전한 오류, 재시도 또는 수동 후보; fixture 대체 없음 |
| 모델이 놓친 내용 | 근거를 고르거나 내부 메모 추가 -> 수동 후보 -> 공개 결정 별도 |

근거 패널은 내부용이다. 원본 파일명/근거 텍스트를 공개 초안에 자동 삽입하지 않는다.

## 4. 데이터

| 읽기 | 쓰기 |
| --- | --- |
| tasks, task_sources, source_versions, 현재 catalog/packs, 적용 가능한 rules | evidence, jobs, candidate_sets, candidates, events, run_traces |
| task_snapshots와 현재 scope | 유효 규칙 자동 적용 시 decisions/current_decisions, phase/current_candidate_set |
| 수동 보완 입력 | 같은 트랜잭션의 user_note source와 evidence, 새 candidate_set |

원본 바이트는 변경하지 않는다. 근거 위치는 UTF-8 byte range, CSV row/column, JSON Pointer를 사용한다. 모델의 offset을 믿지 않고 앱이 ID를 붙인 근거를 응답에서 참조하게 한다.

후보는 `kind`, `uncertainty`, `relevance`, `need_keys`, `statement`, `purpose_relevance`, `evidence_refs`, `origin`, 선택적 conflict group/verified selector를 가진다. 모델이 붙인 schema/topic은 등록 selector가 아니다. 사실/제약/가설/모름이 서로 섞이면 의미 검토/사용자 확인 대상으로 표시한다.

## 5. 규칙/상태/동시성

1. 입력 전체의 형식/크기/모델 요청 예산을 확인한다. 일부만 보내고 전체 분석 완료라고 쓰지 않는다.
2. 시작 시 현재 scope/source/rule/pack을 job snapshot으로 고정한다. DB lock을 놓고 모델을 호출한다.
3. 응답은 `candidate_proposals.v1` strict schema로 검증한다. 근거/local_key/충돌 참조를 확인한다. 영속 ID는 서버가 발급한다.
4. 현재 revision/job/cancel 조건을 확인한 트랜잭션에서 candidate_set을 채택한다. 필요한 경우 snapshot의 재사용 기준을 새 자료에 계산해 파생 결정을 만든다. task snapshot을 수정하지 않는다.
5. 선택이 남으면 needs_decisions, 현재 목표의 작성 전 조건이 충족되면 ready_to_generate다. reproduction_result는 실행 이후의 최종 조건이므로 이 단계에서 없다고 재현 실행을 막지 않는다.
6. 새 분석은 기존 candidate_set을 변경하지 않는다. 이전 후보의 공개 결정을 새 ID로 자동 옮기지 않는다. 유효한 저장 기준 또는 새 사용자 결정을 사용한다.

이미 후보가 있는 작업을 재분석하면 revision을 증가시키고 기존 결과를 무효화한다. 실패한 새 분석의 부분 후보를 현재 집합에 합치지 않는다. 취소/새 선택/작업 삭제 후 늦은 응답은 적용하지 않는다.

수동 후보 추가는 현재 유효 후보를 새 ID로 복제한 새 candidate_set과 새 후보를 원자적으로 만든다. 필요 시 user_note도 같은 transaction에 추가한다. revision 증가 1회, phase=needs_decisions, 과거 결정 자동 이전 없음이다. 이 경로는 모델 호출 없이 가능해야 한다. source가 이미 바뀌어 과거 근거가 무효라면 그 후보는 복제하지 않고 이유를 표시한다.

## 6. 다른 조각과 닿는 곳

| 연결 | 공통 함수 / API | 계약 |
| --- | --- | --- |
| F01 입력 | `AnalysisService.StartAnalysis` / POST tasks/{id}/jobs(kind=analyze) | expected_revision, 현재 입력 전체, 202 job |
| F03 선택 | `AnalysisService.ListCandidates` / GET tasks/{id}/candidates | 현재 집합, 근거/결정 상태/need 요약 |
| F03 수동 보완 | `AnalysisService.AddManualCandidate` / POST tasks/{id}/manual-candidates | statement, kind, uncertainty, need_keys, evidence_ids 또는 user_note, expected_revision |
| 근거 보기 | `EvidenceService.GetEvidence` / GET tasks/{id}/evidence/{id} | 같은 작업/현재/이력 판본 표시, 내부 내용 |
| F06 재사용 | `RuleService.MatchAndProject` | verified selector + scope + 현재 새 자료; 자동 적용 또는 충돌 |
| F04 작성 | `FactPackService.Build` | 분석 응답 전체가 아닌 유효 결정만 전달 |
| F09 진행 | jobs/events | 상태 이벤트만, 원문 스트리밍 없음 |

API 접두사는 `/api/v1`이며 상세 필드와 오류 코드는 api.md가 권위다. 기능 담당자가 별도 후보/권한 DTO를 만들지 않는다.

## 7. 하지 않을 것

공개 여부 자동 확정, 원문에 대한 자동 외부 조회, 대용량 의미 검색/벡터 DB, 무제한 분할 추론, 회사 전체 자료 수집, 평가 정답 읽기, 공급사 내부 상황의 추측을 사실로 쓰기를 하지 않는다.

## 8. 끝났다는 기준

| ID | 확인할 결과 |
| --- | --- |
| AC-F02-01 | txt/CSV/JSON 근거 ID가 원본 판본/위치/hash와 연결되고 화면에서 원문 대조 가능 |
| AC-F02-02 | timeout과 재시도 성공을 관찰로, 서버 완료/중복/원인을 unknown으로 분리 |
| AC-F02-03 | 서로 충돌하는 근거를 한 사실로 조용히 합치지 않음 |
| AC-F02-04 | 알 수 없는 evidence ID, 다른 task 참조, UTF-8 중간 offset은 거부 |
| AC-F02-05 | model 후보 statement/내부 제목/파일명은 공개 결정 전 writer로 넘어가지 않음 |
| AC-F02-06 | 잘린 JSON/중복/미지 키/한도 초과/잘못된 enum을 strict 오류로 처리 |
| AC-F02-07 | 파일 업로드 성공과 모델 분석 가능성을 구분, 문맥 초과를 부분 성공으로 표시하지 않음 |
| AC-F02-08 | 늦은 분석 결과/취소 후 응답/삭제 후 응답은 현재 결과를 바꾸지 않음 |
| AC-F02-09 | 수동 user_note가 source/evidence/후보가 되지만 공개 결정은 별도로 필요 |
| AC-F02-10 | 수동 후보 추가 시 한 revision에서 새 집합 생성, 이전 선택은 참고만, 재결정 필요 |
| AC-F02-11 | 동일 스키마의 새 자료에 저장 기준을 다시 계산하고 모순되는 기준은 질문 |
| AC-F02-12 | fixture/live 구분, 인증 실패/한도 초과에서 fixture로 바꾸지 않음 |
| AC-F02-13 | need_keys ID 존재만으로 의미 충족을 단정하지 않고 최종 의미 검토로 연결 |
| AC-F02-14 | reproduction_result를 실행 전 필수 후보로 요구해 재현 시작을 막지 않음 |

관련 QA: T01, T03-T10, T17-T18, T25, T31-T32, T38-T40, T56. 구체 연결은 [acceptance-map.csv](../acceptance-map.csv).

## 9. 확인 필요

Q-LLM: 사내 모델의 실제 문맥/응답 기능/인증. 미확인 동안 fixture로 도메인/UI 개발 가능. Q-EXT: 실제 라이브러리/제품별 필수 정보 목록은 후속 실제 팩 작성 때 확인한다. 가상 팩의 기본 요구는 제공된 test-data와 공개 계약으로 개발한다.

## 10. 구현 순서와 변경 영향

근거 parser -> strict 후보 검증 -> 모델 없는 수동 후보 -> snapshot/CAS -> fixture 분석 -> live adapter -> rule 연결 -> 빈/실패/충돌 UI. 근거/후보 schema 또는 required need를 바꾸면 F03/F04/F06, ERD/API/contracts, QA를 함께 수정한다.
