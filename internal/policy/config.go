package policy

import (
	"encoding/json"
	"errors"
	"safehandoff.local/poc/internal/domain"
)

func ConfigProjection(c domain.Candidate, r domain.Representation) (domain.Projection, error) {
	p := domain.Projection{Columns: []string{}, Rows: [][]string{}}
	if r.Kind != "fact_summary" || r.TransformID != "" || len(r.Parameters) > 0 {
		return p, errors.New("INVALID_DECISION")
	}
	p.Statement = c.Statement
	return p, nil
}
func ConfigBytes() []byte {
	b, _ := json.MarshalIndent(map[string]any{"upstreams": []map[string]string{{"id": "primary", "address": "192.0.2.17"}}, "route": map[string]string{"upstream_id": "primary"}}, "", "  ")
	return append(b, '\n')
}
