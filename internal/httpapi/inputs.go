package httpapi

import (
	"errors"
	"io"
	"net/http"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/policy"
	"time"
)

func (s *Server) sources(w http.ResponseWriter, r *http.Request) {
	if e := r.ParseMultipartForm(2 << 20); e != nil {
		fail(w, errors.New("INVALID_REQUEST"), 400)
		return
	}
	defer r.MultipartForm.RemoveAll()
	var meta struct {
		Revision int `json:"expected_revision"`
		Items    []struct {
			Key     string `json:"client_key"`
			Name    string `json:"display_name"`
			Format  string `json:"format"`
			Slot    string `json:"source_slot"`
			Replace string `json:"replace_source_id"`
		} `json:"items"`
	}
	if e := domain.Strict([]byte(r.FormValue("meta")), &meta); e != nil {
		fail(w, e, 400)
		return
	}
	if len(meta.Items) == 0 || len(meta.Items) > 10 {
		fail(w, errors.New("INPUT_TOO_LARGE"), 413)
		return
	}
	sources := []domain.Source{}
	keys := map[string]bool{}
	for _, it := range meta.Items {
		if keys[it.Key] || it.Key == "" {
			fail(w, errors.New("INVALID_REQUEST"), 400)
			return
		}
		keys[it.Key] = true
		f, _, e := r.FormFile(it.Key)
		if e != nil {
			fail(w, e, 400)
			return
		}
		b, e := io.ReadAll(io.LimitReader(f, 262145))
		f.Close()
		if e != nil {
			fail(w, e, 400)
			return
		}
		if e = domain.ValidateSource(it.Format, b); e != nil {
			fail(w, e, 400)
			return
		}
		id := it.Replace
		if id == "" {
			id = domain.ID("source")
		}
		sources = append(sources, domain.Source{ID: domain.ID("srcv"), SourceID: id, Version: 1, Name: it.Name, Format: it.Format, Slot: it.Slot, Raw: b, SHA: domain.Hash(b), Included: true})
	}
	s.Service.Store.Mu.Lock()
	defer s.Service.Store.Mu.Unlock()
	t, e := s.Service.Store.Get(r.PathValue("id"))
	if e != nil {
		fail(w, e, 404)
		return
	}
	if t.Revision != meta.Revision {
		fail(w, errors.New("REVISION_CONFLICT"), 409)
		return
	}
	for i := range sources {
		replace := meta.Items[i].Replace
		if replace != "" {
			found := false
			for j := range t.Sources {
				if t.Sources[j].SourceID == replace {
					found = true
					t.Sources[j].Included = false
					if t.Sources[j].Version >= sources[i].Version {
						sources[i].Version = t.Sources[j].Version + 1
					}
				}
			}
			if !found {
				fail(w, errors.New("REFERENCE_INVALID"), 400)
				return
			}
		}
		t.Sources = append(t.Sources, sources[i])
		t.Evidence = append(t.Evidence, domain.EvidenceFor(sources[i])...)
	}
	total, count := 0, 0
	for _, src := range t.Sources {
		if src.Included {
			total += len(src.Raw)
			count++
		}
	}
	if total > 1048576 || count > 10 {
		fail(w, errors.New("INPUT_TOO_LARGE"), 413)
		return
	}
	t.Invalidate("needs_analysis")
	if e = s.Service.Store.Save(t, meta.Revision); e != nil {
		fail(w, e, 409)
		return
	}
	respond(w, 201, map[string]any{"current_revision": t.Revision, "sources": sources})
}
func (s *Server) removeSource(w http.ResponseWriter, r *http.Request) {
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
	for i := range t.Sources {
		if t.Sources[i].SourceID == r.PathValue("source") {
			t.Sources[i].Included = false
			found = true
		}
	}
	if !found {
		fail(w, errors.New("REFERENCE_INVALID"), 404)
		return
	}
	t.Invalidate("needs_analysis")
	if e = s.Service.Store.Save(t, v.Revision); e != nil {
		fail(w, e, 409)
		return
	}
	respond(w, 200, t)
}
func (s *Server) source(w http.ResponseWriter, r *http.Request) {
	t, e := s.Service.Store.Get(r.PathValue("id"))
	if e != nil {
		fail(w, e, 404)
		return
	}
	for _, src := range t.Sources {
		if src.ID == r.PathValue("source") {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Write(src.Raw)
			return
		}
	}
	fail(w, errors.New("REFERENCE_INVALID"), 404)
}
func (s *Server) evidence(w http.ResponseWriter, r *http.Request) {
	t, e := s.Service.Store.Get(r.PathValue("id"))
	if e != nil {
		fail(w, e, 404)
		return
	}
	id := r.PathValue("evidence")
	if e = domain.ValidateEvidence(t, []string{id}); e != nil {
		fail(w, e, 409)
		return
	}
	for _, ev := range t.Evidence {
		if ev.ID == id {
			for _, src := range t.Sources {
				if src.ID == ev.SourceVersionID {
					respond(w, 200, map[string]any{"evidence": ev, "text": string(src.Raw[ev.Start:ev.End])})
					return
				}
			}
		}
	}
}
func (s *Server) candidates(w http.ResponseWriter, r *http.Request) {
	t, e := s.Service.Store.Get(r.PathValue("id"))
	if e != nil {
		fail(w, e, 404)
		return
	}
	respond(w, 200, map[string]any{"candidates": t.Candidates, "decisions": t.Decisions, "revision": t.Revision})
}
func (s *Server) manual(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Revision    int      `json:"expected_revision"`
		Statement   string   `json:"statement"`
		Kind        string   `json:"kind"`
		EvidenceIDs []string `json:"evidence_ids"`
		Note        string   `json:"user_note"`
	}
	if e := decode(r, &v); e != nil {
		fail(w, e, 400)
		return
	}
	if v.Statement == "" || (v.Kind != "observation" && v.Kind != "constraint" && v.Kind != "unknown" && v.Kind != "identifier") {
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
	if t.Revision != v.Revision {
		fail(w, errors.New("REVISION_CONFLICT"), 409)
		return
	}
	if len(v.EvidenceIDs) == 0 {
		if v.Note == "" {
			fail(w, errors.New("BROKEN_EVIDENCE_REFERENCE"), 400)
			return
		}
		src := domain.Source{ID: domain.ID("srcv"), SourceID: domain.ID("source"), Version: 1, Name: "사용자 내부 메모", Format: "txt", Raw: []byte(v.Note), SHA: domain.Hash([]byte(v.Note)), Included: true}
		t.Sources = append(t.Sources, src)
		ev := domain.EvidenceFor(src)
		t.Evidence = append(t.Evidence, ev...)
		for _, x := range ev {
			v.EvidenceIDs = append(v.EvidenceIDs, x.ID)
		}
	}
	if e = domain.ValidateEvidence(t, v.EvidenceIDs); e != nil {
		fail(w, e, 400)
		return
	}
	c := domain.Candidate{ID: domain.ID("cand"), Kind: v.Kind, Statement: v.Statement, Uncertainty: "reported", EvidenceIDs: v.EvidenceIDs, Origin: "human"}
	t.Candidates = append(t.Candidates, c)
	t.Invalidate("needs_decisions")
	if e = s.Service.Store.Save(t, v.Revision); e != nil {
		fail(w, e, 409)
		return
	}
	respond(w, 201, c)
}
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
	RawGrants      []domain.RawGrant     `json:"raw_grants"`
	CandidateID    string                `json:"candidate_id"`
	Disposition    string                `json:"disposition"`
	Representation domain.Representation `json:"representation"`
	PreviewID      string                `json:"preview_id"`
	SHA            string                `json:"projection_sha256"`
	SaveRule       bool                  `json:"save_reusable_rule"`
	ExpiresAt      *time.Time            `json:"expires_at"`
}

func (s *Server) decide(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Revision int         `json:"expected_revision"`
		Ops      []operation `json:"operations"`
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
			if op.SaveRule {
				if !policy.Reusable(*c, op.Representation) {
					fail(w, errors.New("INVALID_DECISION"), 400)
					return
				}
				rule := domain.Rule{ID: domain.ID("rule"), Version: 1, Scope: t.Scope, Selector: c.Selector, Representation: op.Representation, ExpiresAt: op.ExpiresAt}
				rules = append(rules, rule)
				d.RuleID = rule.ID
				d.RuleVersion = rule.Version
			}
		} else if op.SaveRule {
			fail(w, errors.New("INVALID_DECISION"), 400)
			return
		}
		t.Decisions[c.ID] = d
	}
	t.Invalidate("needs_decisions")
	for _, rule := range rules {
		if e = s.Service.Store.PutRule(rule); e != nil {
			fail(w, e, 500)
			return
		}
	}
	allRules, e := s.Service.Store.Rules()
	if e != nil {
		fail(w, e, 500)
		return
	}
	if _, e = policy.Pack(t, allRules, time.Now()); e == nil {
		t.Phase = "ready_to_generate"
	}
	if e = s.Service.Store.Save(t, v.Revision); e != nil {
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
