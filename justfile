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
server:
    mise exec -- pnpm dev:server

client:
    mise exec -- pnpm dev:client
