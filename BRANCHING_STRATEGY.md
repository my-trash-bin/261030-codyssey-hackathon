# Branching Strategy

본 프로젝트는 해커톤의 짧은 개발 일정과 빠른 통합을 고려하여 **Trunk-Based Development (Direct-to-Trunk)** 전략을 채택한다.

## 운영 원칙

- `main`을 단일 공유 개발 브랜치로 사용한다.
- 모든 팀원은 `main`에 직접 commit/push할 수 있다.
- 별도의 feature branch 및 Pull Request는 필수가 아니다.
- 독립적인 실험이나 대규모 변경에는 필요에 따라 단기 브랜치를 사용할 수 있다.
- 충돌 가능성이 높은 변경은 팀원 간 직접 조율한다.
- 공유 브랜치의 force push는 금지한다.
- 문제 발생 시 수정 커밋 또는 `git revert`로 복구한다.
- 최종 시연 및 제출 시점에는 검증된 커밋을 기준으로 안정성을 확보한다.

## 참고

- [Trunk-Based Development](https://trunkbaseddevelopment.com/)
- [Committing Straight to the Trunk](https://trunkbaseddevelopment.com/committing-straight-to-the-trunk/)
