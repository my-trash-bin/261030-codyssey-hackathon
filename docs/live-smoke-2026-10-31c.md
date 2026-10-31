# OSS 재현/grounding 실제 스모크 (3차)

2026-10-31 UTC. 기존 모델 가상 데이터 실행 승인과 두 계획 구현 지시에 따라 로컬 Docker 및 기존 .env의 등록 모델을 사용했다. 실제 업무 원자료/새 외부 모델은 사용하지 않았고 모델 주소/ID/키와 비공개 설정은 기록하지 않는다.

## 실행 범위

가상 author/oss-encoding의 지정 파일 네 개에서 기대 관찰을 assertion으로 확인하고, 후보와 공개 미리보기/새 allow 결정을 fixture로 구성했다. analyze와 사람 승인 UI를 실제로 구현하거나 거쳤다는 뜻은 아니다. 원자료 문자열/내부 경로/가상 인증 표식은 작성/검토 입력과 출력에서 제외했다.

builtin make_synthetic_inputs_v1은 seed=42, 새 길이 6으로 ASCII/한글 입력을 결정적으로 생성했다. 이전 라운드에서 로컬 빌드한 현재 scratch supervisor 이미지의 전체 ID를 명시적 테스트 등록 파일에 고정했다. legacy runner가 존재하는 것만으로 호환된다고 추정하지 않았다. 런타임 pull/build/호스트 shell fallback은 없었다.

## 최종 실제 실행

최종 보고 시각: 2026-10-31 07:42 UTC. 상세 가상 결과는 무시 경로 .local/oss-smoke-final-deterministic.json에 새 파일로 저장했다.

| 대상 | 입력 | 실제 결과 | 파일 |
| --- | --- | --- | --- |
| buggy | 새 ASCII | ok/persist, exit 0 | 입력 바이트와 일치 |
| buggy | 새 한글 | domain_error/encode/E_ENCODE_SHORT_BUFFER, exit 2 | 없음 |
| fixed | 새 ASCII | ok/persist, exit 0 | 입력 바이트와 일치 |
| fixed | 새 한글 | ok/persist, exit 0 | 입력 바이트와 일치 |

execution_summary는 targets=2, inputs=2, total_runs=4, runs_per_combination=1이다. 고정 oracle은 reproduced였다. 이 구조화된 실행 행과 값은 코드로 재검사했다. 컨테이너는 기존 runner의 network none/읽기 전용 root/non-root/자원 제한을 사용했다. 전체 호스트의 인터넷 차단을 검증한 것은 아니며 지정 모델과의 통신은 호스트에서 별도로 발생했다.

명시적 fresh 결정의 scope/source/preview hash와 빈 rules 목록을 groundFacts로 검증하고 실제 모델의 작성/검토를 호출했다. 작성 약 5.47초, 검토 약 5.20초였고 최종 review는 pass였다. 최종 실행에서는 작성 1회와 검토 1회였고 자동 수정 루프는 동작하지 않았다. 앞선 진단 실행에서 확인한 문제는 아래에 구분한다.

최종 초안은 관찰된 encode 오류, 두 버전과 두 입력으로 총 4회 실행한 결과, 원래 사건과 동일한 근본 원인을 증명하지 않는다는 범위를 서술했다. 이 내용 대조는 실행 후 확인이며 자동 의미 회귀 시험이 아니다. 실제 제3자 OSS의 신규 결함 발견이나 근본 원인 확인을 주장하지 않는다.

## 실행 중 확인한 한계와 수정

grounding 연결 후의 앞선 실행에서 모델은 pass를 주었지만 초안에 총 네 번을 각각 네 번으로 잘못 표현한 경우가 있었다. 모델 pass가 의미 정확성의 보증이 아님을 확인했다. 공개 입력 사실을 네 조합 각 한 번, 총 4회로 명확하게 표현하고 실제 실행 수치는 별도의 execution_summary에 고정했다.

일시적으로 추가했던 한국어 의미 정규식 검사는 올바른 부정 문장을 거부하기도 했다. 사용자 지시에 따라 이 검사와 그 회귀 시험을 제거했다. 문장 의미를 정규식으로 판정하거나, 이후 모델 pass를 사람의 승인으로 해석하지 않는다.

모든 보고는 document_status=reviewed_draft_not_finalized, manual_review_required=true를 포함한다. completed는 파이프라인 완료일 뿐 최종 공개 승인이 아니다. 실제 제품의 사람 최종 확인/다운로드 경로는 여전히 후속 범위다.

## 회귀 검증

자동 시험은 builtin 수치/UTF-8 범위/hash/허용 인수, 네 실행 행과 고정 oracle, 필수 fact 참조, scope/source/goal/selector/Rule 판본, 철회/만료, 모델 호출 횟수와 권한 정보의 writer 유입 여부만 판정한다. 의미 평가를 CI 통과 조건에 넣지 않는다. 전체 just check는 기존 모델을 호출하지 않고 fixture 모델과 fake runner를 명시적으로 사용하는 연결 시험을 포함한다.
