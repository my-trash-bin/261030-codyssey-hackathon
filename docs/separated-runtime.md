# 분리된 서버와 클라이언트

이전 웹·재생성 엔진 실험은 pnpm 기반 TypeScript 기본 구조로 교체했다. 지금 남긴 실행 패키지는 packages/server와 packages/client뿐이다. 재생성 엔진·demo/live 모드·이전 실행 관리 명령은 제공하지 않는다.

현재 실행·환경 변수·테스트 명령은 [README](../README.md), 구조는 [architecture](architecture.md), 동작하는 API는 [api](api.md)를 따른다. 현재 범위는 SQLite 문서 저장·조회이며 추가 기능은 다시 설계·구현할 대상이다.
