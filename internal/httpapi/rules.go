package httpapi

import (
	"errors"
	"net/http"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/policy"
	"time"
)

func (s *Server) saveRule(w http.ResponseWriter, r *http.Request) {
	var v struct {
		TaskID      string `json:"task_id"`
		CandidateID string `json:"candidate_id"`
		DecisionID  string `json:"decision_id"`
		Revision    int    `json:"expected_revision"`
	}
	if e := decode(r, &v); e != nil {
		fail(w, e, 400)
		return
	}
	s.Service.Store.Mu.Lock()
	defer s.Service.Store.Mu.Unlock()
	t, e := s.Service.Store.Get(v.TaskID)
	if e != nil {
		fail(w, e, 404)
		return
	}
	d, ok := t.Decisions[v.CandidateID]
	rules, e := s.Service.Store.Rules()
	if e != nil {
		fail(w, e, 500)
		return
	}
	if !ok || d.ID != v.DecisionID || t.Revision != v.Revision || d.Disposition != "allow" || !policy.Active(d, t, rules, time.Now()) {
		fail(w, errors.New("INVALID_DECISION"), 409)
		return
	}
	for _, c := range t.Candidates {
		if c.ID == v.CandidateID && policy.Reusable(c, d.Representation) {
			rule := domain.Rule{ID: domain.ID("rule"), Version: 1, Scope: t.Scope, Selector: c.Selector, Representation: d.Representation, ExpiresAt: d.ExpiresAt}
			old := d.ID
			d.ID = domain.ID("dec")
			d.SupersedesID = old
			d.RuleID = rule.ID
			d.RuleVersion = rule.Version
			t.Decisions[c.ID] = d
			t.Invalidate("ready_to_generate")
			if e = s.Service.Store.SaveWithRules(t, v.Revision, []domain.Rule{rule}); e != nil {
				fail(w, e, 409)
				return
			}
			respond(w, 201, rule)
			return
		}
	}
	fail(w, errors.New("INVALID_DECISION"), 400)
}
func (s *Server) ruleVersion(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Version   int        `json:"expected_rule_version"`
		ExpiresAt *time.Time `json:"expires_at"`
	}
	if e := decode(r, &v); e != nil {
		fail(w, e, 400)
		return
	}
	s.Service.Store.Mu.Lock()
	defer s.Service.Store.Mu.Unlock()
	rules, e := s.Service.Store.Rules()
	if e != nil {
		fail(w, e, 500)
		return
	}
	var latest *domain.Rule
	for i := range rules {
		if rules[i].ID == r.PathValue("rule") && (latest == nil || rules[i].Version > latest.Version) {
			latest = &rules[i]
		}
	}
	if latest == nil || latest.Version != v.Version || latest.Revoked {
		fail(w, errors.New("REVISION_CONFLICT"), 409)
		return
	}
	next := *latest
	next.Version++
	next.ExpiresAt = v.ExpiresAt
	if e = s.Service.Store.PutRule(next); e != nil {
		fail(w, e, 500)
		return
	}
	respond(w, 201, next)
}
