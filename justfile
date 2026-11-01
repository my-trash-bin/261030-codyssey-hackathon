set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

setup:
    mise run setup

# QG가 모든 규칙·타입 검사·빌드·Node 테스트를 실행
check:
    @mise exec -- ./node_modules/.bin/qg check --full 2>&1 | awk '/^(PASS|ERROR|WARNING)( |$)/'

build:
    mise exec -- pnpm build

# 실제 앱 전체: API 서버와 웹 화면을 함께 실행
app:
    @mise exec -- node scripts/bootstrap/app.mjs

# API 서버만 실행 (:8080)
api:
    @mise exec -- node scripts/bootstrap/app.mjs --api

# 웹 화면만 실행 (:5173)
web:
    @mise exec -- node scripts/bootstrap/app.mjs --web

# 연출 전용 가짜 앱. 실제 앱과 DB·포트를 공유하지 않음
fake-app:
    mise exec -- pnpm dev:fake-app

# 가짜 앱을 대상으로 동일 클라이언트 실행
fake-client:
    SERVER_ORIGIN=http://127.0.0.1:8081 CLIENT_PORT=5174 mise exec -- pnpm dev:client


# 최초 준비: mise run setup-presentation (just 자체도 mise로 설치)
setup-presentation:
    mise run setup-presentation

# 개별 슬라이드 HTML은 편집용이며 통합 HTML·PDF만 생성한다.
build-presentation:
    mise exec -- python docs/presentation/build_combined_deck.py
    mise exec -- node tools/build-presentation.mjs

# 이전 Go fixture 녹화의 원본 hash를 확인하고 로컬에 준비한다.
prepare-demo-video:
    mise exec -- node tools/prepare-demo-video.mjs

# 앱·비공개 설정이 없는 영상 전용 디렉터리만 loopback에 노출한다.
preview-demo-video: prepare-demo-video
    mise exec -- python -m http.server 8092 --bind 127.0.0.1 --directory .local/demo-video

# 의존성·브라우저 준비 후 fake-app 화면 시연
demo *args:
    mise exec -- node scripts/demo/bootstrap.mjs {{args}}

# 모델 호출 없는 브라우저 장면·재생 제어 검증
demo-check *args:
    mise exec -- node scripts/demo/bootstrap.mjs --headless --fast --verify-playback {{args}}

# macOS Swift·AVFoundation 필요. 정상 속도 녹화 및 시간 제한 검증
demo-record *args:
    mise exec -- node scripts/demo/bootstrap.mjs --headless --record {{args}}
