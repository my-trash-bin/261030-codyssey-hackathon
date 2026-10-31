set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

setup:
    mise install
    mise exec -- pnpm install --frozen-lockfile

# QG가 모든 규칙·타입 검사·빌드·Node 테스트를 실행
check:
    mise exec -- ./node_modules/.bin/qg check --full

build:
    mise exec -- pnpm build

# 두 터미널에서 각각 실행
app:
    mise exec -- pnpm dev:app

client:
    mise exec -- pnpm dev:client

# 연출 전용 가짜 앱. 실제 앱과 DB·포트를 공유하지 않음
fake-app:
    mise exec -- pnpm dev:fake-app

# 가짜 앱을 대상으로 동일 클라이언트 실행
fake-client:
    SERVER_ORIGIN=http://127.0.0.1:8081 CLIENT_PORT=5174 mise exec -- pnpm dev:client
