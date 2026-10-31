# Core schema 모듈

[core.schema.json](../core.schema.json)은 기존 schema ID와 13개 `$defs` 이름을 유지하는 진입점입니다.
정의는 책임에 따라 다음 파일로 나눕니다.

- [shared.schema.json](shared.schema.json): scope/공개 표현
- [requests.schema.json](requests.schema.json): 작업/미리보기/결정/확정/삭제 요청
- [models.schema.json](models.schema.json): 사실/문서/후보 모델 응답

JSON Schema 검증 엔진에는 진입점과 이 세 모듈을 각 `$id`로 로컬 등록합니다.
모듈 간 `$ref`는 절대 URN이며 외부 네트워크 조회를 사용하지 않습니다.
이름이 같은 진입점의 `$defs`를 선택하는 인터페이스와 확장한 필드/제약은 유지합니다.

`python3 tools/validate_docs.py`는 모듈 참조와 예시의 필수 키를 확인합니다.
이 검사는 완전한 JSON Schema 엔진 검증을 대신하지 않습니다.
