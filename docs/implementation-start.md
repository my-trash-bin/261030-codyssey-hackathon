# 개발 시작

현재 코드 구조와 실행은 [README](../README.md)와 [architecture](architecture.md)를 따른다. 서버·클라이언트는 pnpm workspace의 별도 TypeScript 패키지이며 문서 저장·조회만 구현했다.

```bash
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- just check
```

두 터미널에서 각각 just server와 just client를 실행한다. 클라이언트는 5173, 서버는 8080이며 .env로 변경한다. 기존 provider 설정·업무 DB·재생성 경로는 현재 코드에 연결하지 않는다.

프로젝트 의도와 제품 요구사항은 [intent](../intent.md), [prd](prd.md), [spec](spec.md)에 보존한다. 설계에 기능이 있다는 이유로 구현 완료로 판단하지 않는다.
