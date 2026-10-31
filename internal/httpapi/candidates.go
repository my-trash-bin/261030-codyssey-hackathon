package httpapi

import (
	"errors"
	"net/http"
	"safehandoff.local/poc/internal/domain"
)

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
	if v.Statement == "" || (v.Kind != "observation" && v.Kind != "constraint" && v.Kind != "hypothesis" && v.Kind != "unknown" && v.Kind != "identifier") {
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
	if len(t.Candidates) >= 30 {
		fail(w, errors.New("CANDIDATE_LIMIT"), 413)
		return
	}
	if len(v.EvidenceIDs) == 0 {
		if v.Note == "" {
			fail(w, errors.New("BROKEN_EVIDENCE_REFERENCE"), 400)
			return
		}
		total, count := len([]byte(v.Note)), 1
		for _, source := range t.Sources {
			if source.Included {
				total += len(source.Raw)
				count++
			}
		}
		if len([]byte(v.Note)) > s.Service.MaxFileBytes || total > s.Service.MaxSourceBytes || count > s.Service.MaxFiles {
			fail(w, errors.New("INPUT_TOO_LARGE"), 413)
			return
		}
		src := domain.Source{ID: domain.ID("srcv"), SourceID: domain.ID("source"), Version: 1, Name: "사용자 내부 메모", Format: "txt", Raw: []byte(v.Note), SHA: domain.Hash([]byte(v.Note)), Included: true}
		t.ScopeReduced = false
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
	if c.Kind == "unknown" {
		c.Uncertainty = "unknown"
	}
	if c.Kind == "hypothesis" {
		c.Uncertainty = "inferred"
	}
	t.Candidates = append(t.Candidates, c)
	t.Invalidate("needs_decisions")
	if e = s.Service.Store.Save(t, v.Revision); e != nil {
		fail(w, e, 409)
		return
	}
	respond(w, 201, c)
}
