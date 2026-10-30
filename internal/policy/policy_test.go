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
func TestSelectedFieldsAndZeroRatio(t *testing.T) {
	c := domain.Candidate{Kind: "series", Selector: "csv:requests_v1:observed_at,requests_per_minute:requests_per_minute", Values: []string{"82", "120", "176"}}
	p, e := Project(c, domain.Representation{Kind: "selected_fields", Parameters: map[string]int{"include_count": 1, "include_observation": 1, "include_unit": 0, "start_row": 1, "end_row": 3}})
	if e != nil || len(p.Rows) != 2 || p.Rows[0][1] != "120" || p.Columns[1] != "요청량" {
		t.Fatal(p, e)
	}
	c.Values[0] = "0"
	if _, e = Project(c, domain.Representation{Kind: "derived_table", TransformID: "series_index_base100.v1", Parameters: map[string]int{"decimal_places": 2}}); e == nil {
		t.Fatal("zero baseline")
	}
	c.Values[0] = ""
	if _, e = Project(c, domain.Representation{Kind: "derived_table", TransformID: "series_direction_only.v1"}); e == nil {
		t.Fatal("missing data filled")
	}
}
func TestConflictingAllowedCandidatesBlocked(t *testing.T) {
	task := domain.Task{Revision: 1, Candidates: []domain.Candidate{{ID: "a", Kind: "observation", Statement: "처리 완료 주장", ConflictGroup: "g"}, {ID: "b", Kind: "unknown", Statement: "완료 여부 미확인", ConflictGroup: "g"}}, Decisions: map[string]domain.Decision{}}
	for _, c := range task.Candidates {
		r := domain.Representation{Kind: "fact_summary"}
		p, _ := Project(c, r)
		task.Decisions[c.ID] = domain.Decision{CandidateID: c.ID, Disposition: "allow", Scope: task.Scope, SourceHash: task.SourceHash(), Representation: r, ProjectionSHA: domain.Hash(domain.Canonical(p))}
	}
	if _, e := Pack(task, nil, time.Now()); e == nil || e.Error() != "SOURCE_CONFLICT" {
		t.Fatal(e)
	}
	d := task.Decisions["a"]
	d.Disposition = "exclude"
	task.Decisions["a"] = d
	if _, e := Pack(task, nil, time.Now()); e != nil {
		t.Fatal(e)
	}
}
func TestTimelineDoesNotInventIntervalPermission(t *testing.T) {
	c := domain.Candidate{Kind: "timeline", Statement: "관찰 순서", Observations: []domain.Observation{{Time: "2026-04-21T09:00:00Z", Statement: "요청"}, {Time: "2026-04-21T09:00:05Z", Statement: "응답 대기 초과"}}}
	p, e := Project(c, domain.Representation{Kind: "derived_table", TransformID: "timeline_sequence_only.v1"})
	if e != nil || len(p.Columns) != 2 || strings.Contains(string(domain.Canonical(p)), "2026") {
		t.Fatal(p, e)
	}
	p, e = Project(c, domain.Representation{Kind: "derived_table", TransformID: "timeline_relative_intervals.v1"})
	if e != nil || p.Rows[1][2] != "T+5s" {
		t.Fatal(p, e)
	}
	p, e = Project(c, domain.Representation{Kind: "derived_table", TransformID: "timeline_synthetic_schedule.v1", Parameters: map[string]int{"base_epoch_seconds": 1893456000}})
	if e != nil || !strings.Contains(p.Rows[1][2], "00:01:00") {
		t.Fatal(p, e)
	}
}
