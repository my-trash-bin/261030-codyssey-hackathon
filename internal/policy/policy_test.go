package policy

import (
	"safehandoff.local/poc/internal/domain"
	"strings"
	"testing"
	"time"
)

func TestProjection(t *testing.T) {
	c := domain.Candidate{Kind: "series", Values: []string{"820", "1160", "1740"}}
	p, e := Project(c, domain.Representation{Kind: "derived_table", TransformID: "series_index_base100.v1", Parameters: map[string]int{"decimal_places": 2}})
	if e != nil || p.Rows[1][1] != "141.46" || p.Rows[2][1] != "212.20" {
		t.Fatal(p, e)
	}
	c.Values = []string{"820", "780", "1740"}
	p, e = Project(c, domain.Representation{Kind: "derived_table", TransformID: "series_direction_only.v1"})
	if e != nil || p.Rows[1][1] != "감소" || p.Rows[2][1] != "증가" {
		t.Fatal(p, e)
	}
	p, _ = Project(c, domain.Representation{Kind: "fact_summary"})
	if strings.Contains(p.Statement, "증가") {
		t.Fatal(p)
	}
}
func TestDecisionExpiryScopeRevocation(t *testing.T) {
	task := domain.Task{Scope: domain.Scope{ProjectID: "p"}}
	d := domain.Decision{Scope: task.Scope, SourceHash: task.SourceHash()}
	now := time.Now()
	if !Active(d, task, nil, now) {
		t.Fatal("active")
	}
	d.Revoked = true
	if Active(d, task, nil, now) {
		t.Fatal("revoked")
	}
	d.Revoked = false
	past := now.Add(-time.Second)
	d.ExpiresAt = &past
	if Active(d, task, nil, now) {
		t.Fatal("expired")
	}
	d.ExpiresAt = nil
	task.Scope.RecipientID = "new"
	if Active(d, task, nil, now) {
		t.Fatal("scope")
	}
}
