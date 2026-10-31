# 독립 실행 경계

최종 앱 app과 연출용 가짜 앱 fake-app은 별도 프로세스·포트·DB로 실행한다. 두 앱은 server와 core-interface만 공통 경계로 사용하며 진짜 core와 fake-core를 각각 주입한다. 가짜 연결 지연·실패는 fake-app 내부 책임이다.

실행은 [README](../README.md), 의존성은 [architecture](architecture.md), 진짜 코어와 연출용 껍데기의 독립 구현은 [개발 계획](plan.md)을 따른다.
