# F07 / 제품별 제보 지침과 맥락 검사

등급: P1 계획된 확장 검증 / 담당: 확장/제품 담당 / 의존: F02-F05, F10 / 연결: F06, F08

기준 문서는 [PRD](../product/prd.md), [spec](../design/spec.md), [확장 계약](../design/extensions.md)이다. 이번 기능은 확장 등록과 호출 경계를 실제로 구현하고 두 제품 팩/맥락 검사 예제로 검증한다. 임의 제품마다 좋은 답을 보장하는 기능은 아니다.

## 1. 목적

**라이브러리와 제품마다 필요한 질문/자료 양식/검사를 추가해 공유 자료 준비에 드는 반복 작업을 줄인다.** PRD-10을 구현한다. 예를 들어 라이브러리별 버전 확인, 제보 양식, 작은 예제 실행법, 공급사별 추적 ID 질문을 제공한다.

단순한 정확값 예외를 넘어 '이 제품의 새 설명용 설정에서 쓰인 문서용 주소인가'를 검사하는 확장도 지원한다. 이것이 공개 승인 자체를 대신하지는 않는다.

## 2. 쓰는 사람과 권한

팀의 설치 담당자가 코드/지침을 검토하고 고정 팩을 로컬 registry에 등록한다. 인증된 사용자는 설치된 팩을 작업에 선택한다. 모델은 필요한 질문/팩을 추천할 수 있으나 설치, 코드 수정, 권한 확대, endpoint 변경을 실행하지 못한다.

분석/검토용 문서와 writer용 공개 지침은 분리한다. 사용자 선택만으로 내부 제품 매뉴얼 전체가 작성기로 넘어가서는 안 된다. 실자료의 원문 사용과 정확값 사용은 F03의 현재 결정이 필요하다.

## 3. 화면

| 화면 | 표시/행동 | 빈 상태/실패 |
| --- | --- | --- |
| UI-02 입력 | 설치된 제품별 도우미 이름/목적 선택 | 팩 없음이면 기본 템플릿으로 진행 |
| UI-03 작업 공간 | 적용 제품/팩 버전, 추가 질문, 검사 진행 | 제품 불일치/검사 오류를 이유와 함께 표시 |
| UI-04 공개 선택 | 설명용 설정의 실제 공개 미리보기, 주소 사용 조건 | 선택 미승인 상태에는 자동 예외 없음 |
| UI-06 최종 확인 | 추가 검사 완료/미수행/수정 필요와 해당 파일 위치 | 필수 검사 미수행이면 확정 버튼 차단 |
| UI-09 실행 환경 | 설치 판본/지문/필요 환경/사용 가능 여부 | 바뀐 파일/digest/실행 환경 없음 표시 |

사용자 표현은 '제품별 제보 도우미', '추가 검사'로 쓴다. `skill`, checker ID, 실행 지문은 상세 보기에서만 보인다. 일반 사용 화면에서 임의 코드 업로드/명령어 입력을 요구하지 않는다.

## 4. 데이터

| 저장 대상 | 주요 데이터 | 변경 책임 |
| --- | --- | --- |
| 로컬 catalog/등록 파일 | 팩 manifest, 역할별 지침, 공개 양식, 도구 id/digest | 설치 담당자/시작 설정 |
| `tasks`, `task_snapshots` | 선택 skill IDs, `skill_set_hash`, 목적/revision | 사용자 적용 동작 |
| `decisions`, `fact_packs` | 현재 승인된 설정 예시/공개 슬롯 | F03와 앱 투영 |
| `tool_runs` | 요청 지문, 도구 판본, 상태, 공개 결과, 내부 진단 | 오케스트레이터 |
| `findings` | detector 위치, target hash, 해소 상태/검사 근거 | 앱 검증 후 저장 |
| `reviews`, `artifacts`, `events` | 현재 파일 검사/무효화/진행 | F04/F05/F09 |

별도 '검사기가 승인한 비밀값' 테이블을 만들지 않는다. 예외는 현재 공개 결정을 통과한 결과에 대해 특정 패턴 finding을 해소하는 기록이다. provenance는 앱이 만든 도구 실행과 슬롯의 연결이며 문서 본문에 쓴 문자열을 신뢰하지 않는다.

## 5. 규칙

적용 불변조건은 INV-02-05/07-09/11/12/14-16이다.

### 등록/판본

팩 경로는 등록 루트 안 상대경로만 허용한다. manifest와 모든 참조 파일의 digest를 저장하고 실행 직전 확인한다. 이름/version이 같아도 파일 바이트가 다르면 기존 판본으로 실행하지 않는다. 새 팩을 작업에 적용하면 revision 증가, 기존 artifact stale, 저장 기준 scope 재확인, 작성/검토 재실행이 필요하다.

public-writing 문서와 공개 assets는 설치 담당자의 검토 대상이다. 내부 지침의 '외부에 그대로 붙여넣기' 문장은 권한이 아니다. 팩 안에 shell이나 도구명이 적혀 있어도 registry/역할/현재 결정의 교집합 밖 실행을 허용하지 않는다.

### 호출/결과 채택

앱이 현재 task/revision의 typed arguments를 만든다. 도구는 현재 공개 승인 범위 안의 입력만 받는다. process 출력은 엄격한 JSON 한 개, stderr는 내부 기록이다. 모델의 tool_calls나 텍스트 명령은 자동 실행하지 않는다.

결과는 task revision, current job, cancel 상태, 팩/도구 digest, 입력 hash에 모두 일치할 때만 채택한다. 늦은 checker 응답이 다른 파일의 finding을 해소하지 못한다. 실패/timeout/잘못된 JSON은 통과로 바꾸지 않는다.

### 맥락 예외

`check_doc_ip_context_v1`은 현재 `artifact_set_hash`의 finding 하나를 받는다. 다음 모두가 맞을 때만 `allowed`다: 현재 승인된 generated_config 슬롯, `make_config_example_v1` provenance, 제품 config schema, 올바른 route 참조, 지정 문서용 IP 대역, 현재 팩/승인 범위.

| 입력 상황 | 결과와 후속 행동 |
| --- | --- |
| 승인한 새 설정의 문서용 주소 | 해당 finding만 해소 |
| 같은 주소가 원래 접속 로그에 등장 | 이 예외 적용 안 함; 제거/별도 공개 선택 필요 |
| 문서에 생성 출처를 흉내 낸 문자열 | provenance 불일치, 예외 적용 안 함 |
| 파싱 불가 | unknown, 구조 수정 또는 검토 필요 |
| timeout/실행 실패 | error, 재시도 또는 환경 복구 |
| 다른 finding/hash 반환 | 응답 거부, 기존 finding 미해결 |

allowed가 원문 승인/다른 detector/다른 파일/다음 작업으로 퍼지지 않는다. 조건이 맞지 않는 공개 정보가 꼭 필요하면 F03에서 현재 범위와 실제 값을 다시 확인해야 한다.

## 6. 다른 조각과 닿는 곳

| 상대 | 계약 | 서버 함수/API |
| --- | --- | --- |
| F01/UI-09 | 등록된 목적/팩/도구 상태 | `GetCatalog`, `GET /api/v1/catalog` |
| F02/F04 | 역할별 현재 팩 문서 | `LoadRoleDocuments`, writer에는 공개용만 |
| F03 | 설정 예시의 공개 투영/미리보기 | 기존 disclosure preview/decision batch |
| F04/F05 | typed tool request/result, finding/hash | `RunRegisteredTool`, `CheckFindingContext` |
| F06 | `skill_set_hash` 변경 시 scope 재평가 | 기존 rule 검사 |
| F08 | 고정 target pair/oracle/입력 계약 | 같은 registry, reproduction 별도 판정 |
| F09 | tool 진행/실패/무효화 이벤트 | task event 스트림 |

확장 선택은 task metadata 변경 API를 사용한다. 별도 '예외 전체 허용' endpoint는 만들지 않는다. 원시 process 호출 endpoint도 UI에 노출하지 않는다. process 등록/설치는 설정 파일과 리뷰된 코드 배포로 수행한다.

## 7. 하지 않을 것

스킬 마켓, 인터넷에서 팩 자동 설치, 사용자 임의 스크립트 업로드 UI, model-generated shell 실행, 원자료 전체 마운트, 임의 URL 조회, 모든 주소 일괄 allowlist, 판정 실패를 사용자 체크 하나로 무시하는 기능은 제외한다.

## 8. 끝났다는 기준

| ID | 조건과 기대 결과 |
| --- | --- |
| AC-F07-01 | 두 팩을 catalog에서 선택하고 각 제품의 다른 질문/양식이 적용됨 |
| AC-F07-02 | writer 실제 요청에는 공개 지침만 있고 내부 제품 문서/SKILL.md 전문은 없음 |
| AC-F07-03 | 승인한 새 설정은 문맥 조건에 따라 IP finding만 해소됨 |
| AC-F07-04 | 같은 IP가 원래 접속 로그에 있으면 새 설정 예외로 해소되지 않음 |
| AC-F07-05 | 동일 문맥에서 다른 문서용 IP도 값 고정 없이 판정 가능 |
| AC-F07-06 | 다른 hash/finding, timeout, parse 오류는 허용으로 처리되지 않음 |
| AC-F07-07 | 팩 파일 변경/도구 digest 변경/잘못된 경로는 실행 전 차단됨 |
| AC-F07-08 | builtin과 process checker가 정상/거절/오류 corpus에서 같은 계약 결과를 냄 |
| AC-F07-09 | Docker 미설치 시 호스트 실행으로 대체되지 않으며 필수 checker가 막은 이유 표시 |
| AC-F07-10 | 도구에 미허용 파일/환경변수/네트워크가 없음을 실행 환경으로 확인 |
| AC-F07-11 | 진행 중 팩 변경 뒤 늦은 결과가 현재 finding/artifact를 변경하지 않음 |
| AC-F07-12 | UI에서 특정 finding 해소 이유와 새 공개 승인의 차이를 확인 가능 |

QA 연결: AC-F07-01-02 -> T47/T58, 03-05 -> T11/T48, 06 -> T12, 07 -> T27/T47, 08 -> T12/T48, 09 -> T55, 10 -> T57, 11 -> T03/T47, 12 -> T11/T58. 시간 표현 확장에는 T36도 적용한다. [QA](../qa/qa.md)와 [추적표](../qa/traceability.csv)를 함께 갱신한다.

## 9. 확인 필요

Q-EXT: 실제 라이브러리/제품 한 개의 지침/재현 계약 선정. Q-DEPLOY: 실제 sandbox 실행 가능 환경. Q-LICENSE: 실제 외부 코드/문서/양식의 사용/배포 조건. toy 제품과 직접 작성한 가상 지침의 구현은 이 답을 기다리지 않는다.

## 10. 구현 순서와 변경 영향

등록 manifest/경로/digest 검증 -> 역할별 지침 로딩 -> builtin 도구 -> finding 단위 checker -> process adapter -> 팩 변경 무효화 -> UI -> 실제 실행 검증 순서다. 새 도구를 추가할 때 input/output schema/공개 가능한 결과/오류 코드/필요 권한/검증 corpus를 같은 PR에 포함한다. 공통 권한을 바꾸는 경우 spec/security/API도 수정한다.
