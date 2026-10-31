# CDP 시연 통합 검증 / 2026-10-31

## 통합 범위

`feat/cdp-demo-presentation`의 진행 중이던 `3aaf0a4` 병합을 `fbcfe02`로 완료하고,
원격을 다시 조회해 확인한 최신 main `1aed9c8`까지 `4312e2b`로 병합했다.
6개 unmerged 파일을 검토해 해결하고 fake-app 전용 presentation 파일 3개를 추가했다.
후속 main의 클라이언트 UI/팩 등록/문서 변경을 함께 반영했다.

과거 evaluation 기록은 사용자 지시에 따라 main의 삭제 변경에서 제외해 보존했다.
기존 영상/미리보기/cdp-submission-run.json의 작업 트리 변경은 보존하고 커밋하지 않았다.
`intent.md`/비공개 설정/기존 로컬 DB는 변경하지 않았다.

## 이전 통합 시점 검증

- 공식 `mise exec -- just check`: 통과. 타입/빌드/Node 테스트와 QG 정책을 실행했다.
- main에서 추가한 `packages/client/public/style.css` 파일 길이 경고 1개가 남는다.
- macOS에서 Linux 전용 파일시스템 시험 10개와 팩 등록 시험 3개는 skip이다.
  대신 지원하지 않는 플랫폼의 로딩/등록 거부 계약을 확인했다. Linux 검증 완료를 뜻하지 않는다.
- `mise exec -- pnpm demo:cdp --headless --fast --verify-playback`: 통과.
  21개 장면/8개 가상 후보/이전/다음/타임라인/이동 후 정지/재생을 확인했다.
  실행 기록은 `var/cdp-demo-s5jbub/run.json`이며 가속 실행이므로 제출 시간 근거가 아니다.

정상 속도 `--headless --record`도 통과했다. 실행 기록은
`var/cdp-demo-SqJBJv/run.json`, 새 영상은 같은 폴더의 `submission.mp4`다.
재생 시간은 99973ms, 인코딩 영상은 99975ms로 110초 이내다.
6구간 영상 프레임 추출 검사를 통과했다. 기존 제출 영상은 덮어쓰지 않았다.

## 구현 경계

분석/공개 선택/미리보기/최종 확인은 fake-app 브라우저 연출이다.
문서 생성/저장/조회만 `/api/sharing`/`/api/documents`로 수행하고 fake provenance와 저장 바이트를 확인한다.
실제 분석/승인/확정/내보내기나 외부 제출을 구현/검증한 것으로 해석하지 않는다.

## 후속 통합 / 2026-10-31 18:00 KST

원격 fetch로 main의 추가 3개 커밋을 확인해 `0ff9e8d`까지 `dda256e`로 병합했다.
README와 API 문서의 병렬 추가 충돌은 양쪽 내용을 보존해 해결했다.
intent/과거 평가 기록/비공개 설정/기존 DB는 수정하지 않았다. push는 하지 않았다.

새 main의 발표자료에 한정해 QG 상한을 설정했다. HTML 한 줄 1600자,
생성 통합 HTML 5700줄, 통합 PDF 4000000바이트이며 규칙은 계속 오류로 검사한다.
Linux /proc 기반 등록을 쓰는 신규 시험 6개는 기존 정책처럼 macOS에서 skip한다.
OSS 시험 경로는 fileURLToPath로 변환해 한글 경로의 URL 인코딩을 해제했다.
`mise exec -- just check`는 통과했고 파일 길이 경고 7개가 남는다.
Linux 전용 시험과 실제 Docker 이미지 시험의 skip은 해당 환경의 검증 완료가 아니다.

`mise exec -- pnpm demo:cdp --headless --fast --verify-playback`도 통과했다.
새 기록은 `var/cdp-demo-vdMcqx/run.json`이며 21개 장면/8개 후보와 재생 제어를 확인했다.
가속 실행이므로 제출 영상의 시간 근거로 쓰지 않는다.

정상 속도 `--headless --record`도 통과했다. 기록은 `var/cdp-demo-Wxuyre/run.json`,
새 영상은 같은 폴더의 submission.mp4다. 재생 99934ms,
인코딩 영상 99935ms로 110초 이내이며 6구간 프레임 추출 검사를 통과했다.
기존 제출 묶음은 교체하지 않았다.

## 기존 제출 산출물의 출처 확인

작업 시작 전 미커밋 파일 3개는 덮어쓰거나 커밋하지 않았다.
영상과 미리보기는 모두 `var/cdp-demo-fXMCFV`의 산출물과 바이트 단위로 일치한다.
검증 JSON의 source_run/영상 SHA-256/video/transitions도 해당 실행과 일치한다.
미리보기는 같은 실행의 final.png이며 실제 파일 확인 장면을 표시한다.
별도 playback_test는 `var/cdp-demo-ylfdaq/run.json`의 통과 기록을 참조한다.
따라서 녹화 실행과 재생 제어 시험은 서로 다른 실행이다.

- 영상 SHA-256: `0dfa0b105861d0ee5ec0e7aaa586276e2d50a99738386587dabc2ad336c69c6c`
- 미리보기 SHA-256: `e676b6723c1ac7ae0423063eda586c3053491b2634f6a52006cf2566891f2849`
- 검증 JSON SHA-256: `62bb9506c3e9fca83fd52e3f0582875e1c64d95b5f32856a85f0d5fdc752891e`

영상 길이는 99988ms로 110초 이내다. JSON의 integrated_main은 `3aaf0a4`다.
이 묶음은 과거 실행의 일관된 산출물이며 최신 main 검증 결과로 재표시하지 않는다.
최신 통합 검증은 위 새 실행 기록으로 구분한다. 기존 JSON은 갱신하지 않았다.

## 마무리 검토와 별도 제출 묶음

작업 재개 후 원격을 다시 fetch했고 main은 `0ff9e8d`로 추가 변경이 없었다.
정상 속도 녹화의 시작/중간/마지막 추출 프레임에서 자막과 fake-app 표시를 확인했다.
녹화 이후 병합 커밋 `dda256e`와 `dd68d06` 사이의 packages/시연 스크립트/입력 fixture/
의존성 파일 차이가 없음을 확인했다. 녹화 당시 없던 Git provenance를 원본 run에 추가하지 않았다.

최신 묶음은 로컬 `var/cdp-submission-qtfxj0s8`에 새로 만들었다.
submission.mp4/미리보기 final.png/run.json/6개 영상 추출 프레임은 모두
`var/cdp-demo-Wxuyre`의 파일과 SHA-256이 일치한다. playback-run.json은 별도 재생 시험
`var/cdp-demo-vdMcqx`의 복사본이다. verification.json은 각 파일의 출처/길이/해시와
main/검토 HEAD/시험 경계를 기록한다. 기존 로컬 DB나 비공개 설정은 묶음에 포함하지 않았다.
이 폴더는 로컬 산출물이며 Git 커밋이나 외부 제출을 수행하지 않았다.

- 영상 SHA-256: `9e7f2d30b9e1cb98414818e47181a05ade0ff50ee852f0d6a12a8c81ac83d59e`
- 미리보기 SHA-256: `3b966d7f1e273dc0b68d9e2c441991f9595316b83a5b84be416dc74e19bdc98d`
- 검증 JSON SHA-256: `b1c982689e2c10243c029f0055d497efa682c447260d7f486d73cf2e2eed013a`

Docker CLI는 설치돼 있지만 로컬 데몬 소켓이 없어 실제 컨테이너 시험을 실행할 수 없었다.
현재 호스트는 macOS이므로 Linux /proc 기반 팩 시험도 미검증이다.
이 두 시험은 후속 Linux/Docker 환경에서 수행해야 하며 이전 실행 문서를 성공 근거로 쓰지 않았다.
QG의 파일 길이 경고 7개는 유지한다. 오류는 없고 발표자료에 한정한 수치 상한을 적용한다.


## main 후속 병합과 Linux 시연 확인

병합 커밋 `7d9e9ad`에서 QG 충돌을 해결했다. 이후 just demo/demo-check/demo-record를
빌드와 연결하고, macOS 외 환경에서는 설치된 Playwright Chromium을 선택하도록 수정했다.
CHROME_PATH의 명시적 지정은 유지한다. 실제 작업 UI와 fake-app 발표 화면은 분리돼 있다.

현재 Linux에서 `just check`가 통과했다. `just demo-check`도 가상 후보 8개,
문서 생성/저장/조회와 이전/다음/타임라인 이동/도착 후 정지/재생 검증을 통과했다.
실행 기록은 로컬 `var/cdp-demo-1Yl9rI/run.json`이다. 가속 실행 7.24초는 제출 시간 근거가 아니다.
호스트가 Chromium sandbox 초기화를 지원하지 않아 이 실행에서만 CHROME_PATH에
임시 --no-sandbox 래퍼를 지정했다. 기본 실행 옵션과 제품 보안 설정은 바꾸지 않았다.
macOS 전용 MP4 녹화는 이번 Linux 검사에서 실행하지 않았다. 실제 분석/승인 구현의 검증도 아니다.
