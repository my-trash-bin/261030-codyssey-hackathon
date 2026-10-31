# 영상 연출 참고자료

원격 `origin/feat/cdp-demo-presentation`의 `8894bc6610b9c4faac19ee4a83608265ad0e5fec`를 확인해
영상·연출 소스를 분리했다. 이 고정 스냅샷은 이전 Go 시제품을 대상으로 한다. 이후 브랜치의 fake-app 이식본이 main에
병합되었다. 현행 시연 실행은 [루트 README의 CDP 화면 시연](../../../README.md)을 따른다.
이 디렉터리의 원본 스냅샷과 영상은 그대로 과거 자료다.

현행 실행·완료 범위는 [루트 README](../../../README.md)·[API](../../api.md), 발표 운영은
[가이드](../GUIDE.md), 실제 실행 기록 형식은 [transcript](../../transcript.md)를 참조한다.
여기에는 그 정본의 기능 설명을 복제하지 않는다.

## 확인과 재생

고정한 과거 MP4를 Git 객체에서 로컬에 꺼내 hash를 검증한다. 대용량 영상을 main에 다시 추가하지
않고 `.local/demo-video/`에 둔다. 처음에는 해당 원격 브랜치의 객체가 필요하다.

```sh
git fetch origin feat/cdp-demo-presentation
mise install
mise exec -- just prepare-demo-video
mise exec -- just preview-demo-video
```

브라우저에서 `http://127.0.0.1:8092`를 연다. loopback 전용 정적 서버이며 Ctrl-C로 종료한다.
사내 자료·.env·DB를 서비스하지 않고 영상·포스터·재생 안내만 있는 디렉터리를 노출한다.
preview 명령도 준비·hash 검증을 먼저 한다. 모델 호출·앱 기동·새 촬영은 없다.

과거 기록의 길이는 103.140초, 110초 제한 기준의 fixture 연출이다. 이는 원래 커밋에 포함된
기록이며 현재 제품의 성공·준비 시간 절감·live 모델 품질을 증명하지 않는다. 현재 준비 명령은
바이트 hash만 검사하며 길이·화질의 새 측정 결과라고 보고하지 않는다.

## 파일과 코드의 상태

| 파일 | 역할 |
| --- | --- |
| source.json | 원본 커밋·경로·영상 hash·참고 코드 hash. 과거 보고와 현재 상태 구분 |
| poster.png | 원래 녹화의 참고 화면. 현재 앱 스크린샷이 아님 |
| player.html | 로컬 영상 디렉터리로 복사하는 재생 안내 템플릿 |
| reference/*.txt | 원래 scripts/demo 코드의 exact-byte 스냅샷. 실행 프로그램으로 등록하지 않음 |

소스는 원본 경로와 hash를 source.json에 기록했다. `.mjs.txt`·`.swift.txt` 확장자는 현재 앱에서
바로 실행할 수 없다는 점을 명시하기 위한 것이다. 제출 영상·크롬 프로필·프레임·실행 DB·실행
보고서는 생성물이며 `.local/`에 둔다. 과거 evaluation 성공 기록을 현재 평가 결과로 복사하지 않았다.

## 과거 스냅샷과 현행 이식본의 차이

- run.mjs는 `bin/safehandoff --fixture`와 옛 Go API·DOM 선택자를 사용한다. 현재 pnpm 앱에는
  그 계약이 없다. 현행 `scripts/demo/run.mjs`와 `demo:cdp`는 별도의 fake-app 이식본이다.
- recording.mjs·encode.swift는 macOS swiftc·AVFoundation 전용이다. 현재 mise/Playwright
  Chromium의 Linux 실행은 화면 시연·재생 검증까지이며 MP4 녹화는 macOS 전용이다.
- playback·scenes·stage의 일시정지·장면 이동·자막·커서·전환은 현행 이식본에도 연결됐다.
  현재 task/decision API가 없는 흐름을 DOM만 바꿔 실제 승인 성공처럼 만들지 않는다.
- 현행 UI를 촬영하는 시연, 고정 응답 연출, transcript 재생은 각각 모드를 표시한다. 이식 후에도
  별도 loopback 서버·브라우저 프로필·DB를 쓰고 일반 앱 CSP를 낮추지 않는다.

현행 이식·녹화의 당시 검증은 [CDP 통합 기록](../../cdp-integration-2026-10-31.md)을 따른다.
이 디렉터리의 과거 영상을 발표에서 쓰면 “이전 fixture
시제품 녹화”라고 소개한다. B2B 포장 결정은 [PRES-DEC-01](../../decisions.md)을 따르되 과거
녹화가 현행 구현으로 바뀌지는 않는다.

## 이번 정리에서 확인한 것

2026-10-31 현행 환경에서 `just prepare-demo-video`를 재실행해 동일 hash로 준비되는 것을
확인했다. `just preview-demo-video`의 loopback 페이지를 Playwright Chromium으로 열어 실제
재생 진행, metadata 길이 103.14초·1440×1000, 과거 fixture 표시를 확인했다. 참고 코드 7개의
hash도 manifest와 대조했다. 확인 후 미리보기 서버를 종료했으며 전체 `just check`가 통과했다.
이는 기존 녹화 파일의 재생 확인이며 새 제품 실행·녹화 검증은 아니다.
