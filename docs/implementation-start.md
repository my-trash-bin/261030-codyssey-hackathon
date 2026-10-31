# 개발 시작

현재 [패키지 경계](architecture.md)와 [독립 개발 계획](plan.md)을 먼저 읽는다. app은 실제 앱, fake-app은 연출용 앱이다. 진짜 코어는 packages/core에서 별도로 개발하며 fake-app과 fake-core의 개선에 실제 앱 수정을 요구하지 않는다.

```bash
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- just check
```

각 터미널에서 just app, just fake-app, just client를 실행한다. 연출 조절 화면은 http://127.0.0.1:8081/__demo 이다. 현재 진짜 코어는 미구현이며 실제 API는 [api](api.md)를 따른다.
