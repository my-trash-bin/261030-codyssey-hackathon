package httpapi

import (
	"errors"
	"net/http"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/policy"
	"time"
)

func (s *Server) preview(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Revision       int                   `json:"expected_revision"`
		CandidateID    string                `json:"candidate_id"`
		Representation domain.Representation `json:"representation"`
		RawGrants      []domain.RawGrant     `json:"raw_grants"`
	}
	if e := decode(r, &v); e != nil {
		fail(w, e, 400)
		return
	}
	if v.Representation.Parameters == nil {
		v.Representation.Parameters = map[string]int{}
	}
	s.Service.Store.Mu.Lock()
	defer s.Service.Store.Mu.Unlock()
	t, e := s.Service.Store.Get(r.PathValue("id"))
	if e != nil {
		fail(w, e, 404)
		return
	}
	if t.Revision != v.Revision {
		fail(w, errors.New("REVISION_CONFLICT"), 409)
		return
	}
	for _, c := range t.Candidates {
		if c.ID == v.CandidateID {
			p, e := policy.ProjectFor(t, c, v.Representation, v.RawGrants)
			if e != nil {
				fail(w, e, 400)
				return
			}
			pr := domain.Preview{ID: domain.ID("preview"), RawGrants: v.RawGrants, Revision: t.Revision, CandidateID: c.ID, Representation: v.Representation, Projection: p, SHA: domain.Hash(domain.Canonical(p))}
			t.Previews[pr.ID] = pr
			if e = s.Service.Store.Save(t, t.Revision); e != nil {
				fail(w, e, 409)
				return
			}
			respond(w, 200, pr)
			return
		}
	}
	fail(w, errors.New("REFERENCE_INVALID"), 400)
}

type operation struct {
	AppliedRuleID      string                `json:"applied_rule_id"`
	AppliedRuleVersion int                   `json:"applied_rule_version"`
	RawGrants          []domain.RawGrant     `json:"raw_grants"`
	CandidateID        string                `json:"candidate_id"`
	Disposition        string                `json:"disposition"`
	Representation     domain.Representation `json:"representation"`
	PreviewID          string                `json:"preview_id"`
	SHA                string                `json:"projection_sha256"`
	SaveRule           bool                  `json:"save_reusable_rule"`
	ExpiresAt          *time.Time            `json:"expires_at"`
}

func (s *Server) decide(w http.ResponseWriter, r *http.Request) {
	var v struct {
		AcceptReduction bool        `json:"accept_scope_reduction"`
		Revision        int         `json:"expected_revision"`
		Ops             []operation `json:"operations"`
	}
	if e := decode(r, &v); e != nil || len(v.Ops) == 0 {
		fail(w, errors.New("INVALID_REQUEST"), 400)
		return
	}
	s.Service.Store.Mu.Lock()
	defer s.Service.Store.Mu.Unlock()
	t, e := s.Service.Store.Get(r.PathValue("id"))
	if e != nil {
		fail(w, e, 404)
		return
	}
	if t.Revision != v.Revision || t.Phase == "needs_analysis" {
		fail(w, errors.New("REVISION_CONFLICT"), 409)
		return
	}
	seen := map[string]bool{}
	rules := []domain.Rule{}
	for _, op := range v.Ops {
		var c *domain.Candidate
		for i := range t.Candidates {
			if t.Candidates[i].ID == op.CandidateID {
				c = &t.Candidates[i]
			}
		}
		if c == nil || seen[op.CandidateID] || (op.Disposition != "allow" && op.Disposition != "exclude" && op.Disposition != "defer") || (op.ExpiresAt != nil && !time.Now().Before(*op.ExpiresAt)) {
			fail(w, errors.New("INVALID_DECISION"), 400)
			return
		}

		if op.Disposition != "allow" {
			if op.Representation.Kind != "" || op.Representation.TransformID != "" || len(op.Representation.Parameters) > 0 || len(op.RawGrants) > 0 || op.AppliedRuleID != "" {
				fail(w, errors.New("INVALID_DECISION"), 400)
				return
			}
			op.Representation = domain.Representation{Kind: "fact_summary", Parameters: map[string]int{}}
		} else if op.Representation.Parameters == nil {
			op.Representation.Parameters = map[string]int{}
		}
		seen[op.CandidateID] = true
		d := domain.Decision{ID: domain.ID("dec"), RawGrants: op.RawGrants, SupersedesID: t.Decisions[c.ID].ID, CandidateID: c.ID, Disposition: op.Disposition, Representation: op.Representation, Scope: t.Scope, SourceHash: t.SourceHash(), ExpiresAt: op.ExpiresAt}
		if op.Disposition == "allow" {
			pr, ok := t.Previews[op.PreviewID]
			p, err := policy.ProjectFor(t, *c, op.Representation, op.RawGrants)
			sha := domain.Hash(domain.Canonical(p))
			if !ok || err != nil || pr.Revision != t.Revision || pr.CandidateID != c.ID || pr.SHA != op.SHA || string(domain.Canonical(pr.RawGrants)) != string(domain.Canonical(op.RawGrants)) || sha != pr.SHA || string(domain.Canonical(pr.Representation)) != string(domain.Canonical(op.Representation)) {
				fail(w, errors.New("INVALID_DECISION"), 400)
				return
			}
			if e = domain.ValidateEvidence(t, c.EvidenceIDs); e != nil {
				fail(w, e, 400)
				return
			}
			d.ProjectionSHA = sha

			if op.AppliedRuleID != "" {
				if op.SaveRule {
					fail(w, errors.New("INVALID_DECISION"), 400)
					return
				}
				registered, err := s.Service.Store.Rules()
				if err != nil {
					fail(w, err, 500)
					return
				}
				matched := false
				for _, rule := range registered {
					if rule.ID == op.AppliedRuleID && rule.Version == op.AppliedRuleVersion && !rule.Revoked && rule.Scope == t.Scope && rule.Selector == c.Selector && (rule.ExpiresAt == nil || time.Now().Before(*rule.ExpiresAt)) && string(domain.Canonical(rule.Representation)) == string(domain.Canonical(op.Representation)) && policy.Reusable(*c, op.Representation) {
						matched = true
						d.RuleID = rule.ID
						d.RuleVersion = rule.Version
						if rule.ExpiresAt != nil && (d.ExpiresAt == nil || rule.ExpiresAt.Before(*d.ExpiresAt)) {
							d.ExpiresAt = rule.ExpiresAt
						}
					}
				}
				if !matched {
					fail(w, errors.New("SCOPE_MISMATCH"), 409)
					return
				}
			}
			if op.SaveRule {
				if !policy.Reusable(*c, op.Representation) {
					fail(w, errors.New("INVALID_DECISION"), 400)
					return
				}
				existing, err := s.Service.Store.Rules()
				if err != nil {
					fail(w, err, 500)
					return
				}
				existing = append(existing, rules...)
				rule, err := policy.NextRule(existing, t.Scope, c.Selector, op.Representation, op.ExpiresAt)
				if err != nil {
					fail(w, err, 409)
					return
				}
				rules = append(rules, rule)
				d.RuleID = rule.ID
				d.RuleVersion = rule.Version
			}
		} else if op.SaveRule {
			fail(w, errors.New("INVALID_DECISION"), 400)
			return
		}
		if op.Disposition != "defer" {
			pending := []string{}
			for _, id := range t.PendingDecisionIDs {
				if id != c.ID {
					pending = append(pending, id)
				}
			}
			t.PendingDecisionIDs = pending
			c.NeedsDecision = false
		}
		t.Decisions[c.ID] = d
	}
	if v.AcceptReduction {
		t.ScopeReduced = true
	}
	t.Invalidate("needs_decisions")
	allRules, e := s.Service.Store.Rules()
	if e != nil {
		fail(w, e, 500)
		return
	}
	allRules = append(allRules, rules...)
	if _, e = policy.Pack(t, allRules, time.Now()); e == nil {
		t.Phase = "ready_to_generate"
	}
	if e = s.Service.Store.SaveWithRules(t, v.Revision, rules); e != nil {
		fail(w, e, 409)
		return
	}
	respond(w, 200, map[string]any{"current_revision": t.Revision, "phase": t.Phase})
}
func (s *Server) revokeDecision(w http.ResponseWriter, r *http.Request) {
	var v revision
	if e := decode(r, &v); e != nil {
		fail(w, e, 400)
		return
	}
	s.Service.Store.Mu.Lock()
	defer s.Service.Store.Mu.Unlock()
	t, e := s.Service.Store.Get(r.PathValue("id"))
	if e != nil {
		fail(w, e, 404)
		return
	}
	if t.Revision != v.Revision {
		fail(w, errors.New("REVISION_CONFLICT"), 409)
		return
	}
	found := false
	for id, d := range t.Decisions {
		if d.ID == r.PathValue("decision") {
			d.Revoked = true
			t.Decisions[id] = d
			found = true
		}
	}
	if !found {
		fail(w, errors.New("REFERENCE_INVALID"), 404)
		return
	}
	t.Invalidate("needs_decisions")
	if e = s.Service.Store.Save(t, v.Revision); e != nil {
		fail(w, e, 409)
		return
	}
	respond(w, 200, t)
}
