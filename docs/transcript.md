# 실행 transcript와 데모 연결

실제 app과 OSS 스모크의 작성/검토 흐름은 같은 `FileTranscriptSink`를 사용한다. 기본은 꺼져 있다. 다음 환경 변수를 설정하면 실행마다 별도 JSONL 파일을 만든다. 상대 경로는 저장소 루트 기준이다.

```sh
SAFEHANDOFF_TRANSCRIPT_DIR=.local/transcripts
SAFEHANDOFF_TRANSCRIPT_CONTENT=1
```

CONTENT를 생략하면 단계/호출 순서/토큰 사용량/결과/고정 오류 코드만 남긴다. `1`이면 모델 요청(프롬프트와 승인된 FactPack 포함), 검증된 작성 초안도 남긴다. reviewer 원문 응답/내부 설명/원자료 grounding context/환경 변수/API 키/endpoint/모델 이름은 자동으로 기록하지 않는다. 입력 문장 자체에 들어 있는 비밀을 자동 탐지하거나 제거하는 기능은 없다. 내용 기록은 가상 데이터나 기록을 허용한 입력에만 사용하고 공개할 파일은 사람이 검토한다.

예를 들어 빌드 후 아래 명령은 외부 모델 대신 고정 응답 fixture를 사용하면서 실제 Docker 재현과 작성/검토 기록을 만든다. `--live-model`을 추가하면 기존 설정 모델을 실제 호출한다.

```sh
SAFEHANDOFF_TRANSCRIPT_DIR=.local/transcripts SAFEHANDOFF_TRANSCRIPT_CONTENT=1 \
  node tools/oss-repro-smoke.mjs --registration .local/oss-smoke-registration.json \
  --output .local/oss-smoke-transcript.json
```

`transcript-<run_id>.jsonl`의 각 줄은 `transcript.v1` 객체다. `run_id`는 실행별 UUID, `sequence`는 0부터 연속 증가, `elapsed_ms`는 시작 이후 경과 시간이다. `operation`은 write/review/writeReviewed/reproduce, `source=real_core`는 실행한 엔진이다. `run_started.data.model_mode`는 fixture/live를 구분한다. 녹화 파일을 재생할 때는 별도로 녹화 재생 표시를 해야 하며, live 값은 녹화 당시 모델 호출 방식만 뜻한다.

이벤트는 다음 순서 관계를 갖는다. 재시도/수정 때 같은 단계가 여러 번 나타날 수 있다.

- `run_started`: 실행 시작과 모델 모드.
- `model_started`: role, 실행 내 call 번호, 단계 내 attempt 번호. 내용 모드에서는 요청을 content에 포함.
- `model_completed`: role, call, usage. writer의 검증된 초안만 content에 포함.
- `model_failed`: 고정 오류 코드. 검증 실패도 포함하며 임의 오류 메시지는 저장하지 않음.
- `review_completed`: 결과와 reason code 목록. 사전 grounding 거부는 모델 호출 없이 grounding=denied.
- `repair_started`: 수정 회차.
- `reproduction_started` / `reproduction_completed`: Engine.reproduce 직접 호출 시 기록. 내용 모드에서 재현 결과 포함.
- `run_completed` / `run_failed`: 정상 반환 또는 예외 종료. 정상 반환이 검토 통과를 의미하지는 않음.

미래 데모 소비자는 파일을 줄 단위로 읽고 schema_version을 확인한 뒤 sequence 순으로 표시한다. elapsed_ms 차이로 실제 지연을 재생하거나 배속할 수 있다. content가 없으면 상태만 표시한다. writer 초안은 model_completed.content, 최종 검토 상태는 마지막 review_completed.data.result를 사용한다. 검토 pass도 사람의 최종 공개 승인을 의미하지 않는다. 리뷰어 내부 설명은 데모 화면으로 전달하지 않는다.

동시 실행은 파일과 run_id로 분리한다. 파일 권한은 0600, 디렉터리는 0700이며 기존 디렉터리에 그룹/다른 사용자 권한이 있으면 시작을 거부한다. 기록을 켠 상태에서 쓰기 실패는 실행 실패로 취급한다. 서버가 강제 종료되면 마지막 종료 이벤트가 없을 수 있으므로 소비자는 이를 중단된 실행으로 표시한다.

새 실행 시작 때 같은 디렉터리의 transcript 파일명과 일치하는 일반 파일 중 수정 후 24시간 지난 파일을 정리한다. 앱이 멈춰 있으면 정리도 멈춘다. 엄격한 24시간 보존이 필요하면 운영 측 타이머가 추가로 필요하다. task 삭제 연동과 상시 만료 타이머는 아직 구현하지 않았다. HTTP 조회 API/데모 재생 UI/원자료 분석/도구 5개의 전체 타임라인도 이번 범위에 포함하지 않는다. OSS 스모크는 Docker 결과를 기존 보고서에, 작성/검토 흐름을 transcript에 남긴다. 라이브러리 소비자는 TranscriptSink를 주입해 별도 저장소에 연결할 수 있다.

OSS 보고서의 transcript_run_ids는 해당 작성/검토 기록의 run_id 목록이다. 파일명에 같은 ID가 들어가므로 동시 실행된 다른 보고서의 기록과 혼동하지 않고 연결할 수 있다. 기록이 꺼져 있으면 빈 목록이다.

ToyRecord catalog 모드에서는 run_started 바로 다음에 pack_selected 이벤트가 나타난다. data는
OSS 보고서의 selected_pack과 같고 팩 pin/target_pair_id/skill_set_hash를 담는다. role 문서
본문이나 설치 경로는 포함하지 않는다.


F02 analyze는 원자료를 다루므로 내용 기록 옵션과 관계없이 요청/응답 본문을 저장하지 않는다.
analysis_parsed는 source/evidence 개수, analysis_completed는 candidate/conflict 개수를 담는다.
기존 model_* 이벤트에는 role/call/attempt/usage/고정 오류 코드만 들어간다. 파서 오류/취소/모델
실패도 종료 이벤트를 남기며 원자료/파일명/후보 statement는 제외한다.
