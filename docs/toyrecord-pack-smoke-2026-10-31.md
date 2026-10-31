# ToyRecord catalog 연결 실제 실행 확인

2026-10-31 UTC. 새 팩 연결을 구현한 현재 코드로 가상 자료/fixture 모델과 실제 로컬 Docker를
실행했다. 외부 모델은 호출하지 않았다. 과거 실행 결과를 새 실행 결과로 재사용하지 않았다.

`pack-register.mjs`로 toyrecord-repro 1.0.0을 로컬 catalog에 등록하고, 운영자 등록에는 해당
pack pin과 기존에 등록된 로컬 image의 정확한 digest를 결합했다. 실행마다 `--catalog`,
`--pack-version 1.0.0`, `--registration`, `--seed`를 지정하고 상세 transcript를 켰다.

팩 지문은 `bac752f7be54b6661c952c934baaf19b163ee42c0470ff570cc241cab80661b1`이다.
운영자 image 값/설치 경로/연결 설정은 이 문서에 복사하지 않았다.

| seed | 실제 runner | target/input 실행 수 | 재현 | fixture 검토 | 파이프라인 |
| --- | --- | --- | --- | --- | --- |
| 42 | docker | 4 | reproduced | pass | completed |
| 7 | docker | 4 | reproduced | pass | completed |
| 2026 | docker | 4 | reproduced | pass | completed |

각 보고서의 transcript_run_ids가 실제 파일로 연결되고, run_started 다음 pack_selected가
보고서 selected_pack과 동일한지 확인했다. 마지막 이벤트는 모두 run_completed였다. 보고서는
각각 `.local/toyrecord-pack-42.json`, `.local/toyrecord-pack-7.json`,
`.local/toyrecord-pack-2026.json`에 있으며 로그/운영자 등록과 함께 로컬에만 남겼다.

결정적 회귀는 pack 변경/중복/누락/version/미등록 ID/도구 누락/재현 명세 오류/운영자 등록
불일치/CLI 인수/보고서/transcript 연결을 검사했다. 전체 `just check`도 통과했다.

fixture 검토 pass는 실제 모델의 판단이나 문장 의미 정확도 검증이 아니다. candidate/공개 결정은
여전히 명시적 fixture이고 analyze()/역할 문서 프롬프트 주입/서버 task 변경 무효화/도구 권한
교집합의 일반화/사람의 최종 공개 승인은 구현하지 않았다.
