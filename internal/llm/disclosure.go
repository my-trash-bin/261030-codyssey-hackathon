package llm

import "safehandoff.local/poc/internal/domain"

type Disclosure struct {
	Schema         string                 `json:"schema_version"`
	Status         string                 `json:"status"`
	CandidateID    string                 `json:"candidate_id"`
	Representation *domain.Representation `json:"representation"`
	Clarify        bool                   `json:"requires_clarification"`
}
