package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"safehandoff.local/poc/internal/artifact"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/policy"
	"strconv"
	"time"
)

func (s *Server) startJob(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Revision int    `json:"expected_revision"`
		Kind     string `json:"kind"`
	}
	if e := decode(r, &v); e != nil {
		fail(w, e, 400)
		return
	}
	j, e := s.Service.Start(r.PathValue("id"), v.Revision, v.Kind)
	if e != nil {
		fail(w, e, 409)
		return
	}
	respond(w, 202, j)
}
func (s *Server) job(w http.ResponseWriter, r *http.Request) {
	ts, e := s.Service.Store.List()
	if e != nil {
		fail(w, e, 500)
		return
	}
	for _, t := range ts {
		for _, j := range t.Jobs {
			if j.ID == r.PathValue("job") {
				respond(w, 200, j)
				return
			}
		}
	}
	fail(w, errors.New("NOT_FOUND"), 404)
}
func (s *Server) cancelJob(w http.ResponseWriter, r *http.Request) {
	var v revision
	if e := decode(r, &v); e != nil {
		fail(w, e, 400)
		return
	}
	s.Service.Store.Mu.Lock()
	defer s.Service.Store.Mu.Unlock()
	ts, e := s.Service.Store.List()
	if e != nil {
		fail(w, e, 500)
		return
	}
	for _, t := range ts {
		for i := range t.Jobs {
			if t.Jobs[i].ID == r.PathValue("job") {
				if t.Revision != v.Revision {
					fail(w, errors.New("REVISION_CONFLICT"), 409)
					return
				}
				t.Jobs[i].Cancel = true
				t.Phase = "needs_attention"
				t.Event("job.failed")
				if e = s.Service.Store.Save(t, t.Revision); e != nil {
					fail(w, e, 409)
					return
				}
				respond(w, 200, t.Jobs[i])
				return
			}
		}
	}
	fail(w, errors.New("NOT_FOUND"), 404)
}
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE unavailable", 500)
		return
	}
	last, _ := strconv.Atoi(r.Header.Get("Last-Event-ID"))
	w.Header().Set("Content-Type", "text/event-stream")
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		t, e := s.Service.Store.Get(r.PathValue("id"))
		if e != nil {
			return
		}
		for _, ev := range t.Events {
			if ev.Seq > last {
				fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", ev.Seq, ev.Type, domain.Canonical(ev))
				last = ev.Seq
			}
		}
		fmt.Fprint(w, ": heartbeat\n\n")
		fl.Flush()
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		}
	}
}
func (s *Server) getArtifact(w http.ResponseWriter, r *http.Request) {
	t, e := s.Service.Store.FindArtifact(r.PathValue("artifact"))
	if e != nil {
		fail(w, e, 404)
		return
	}
	for _, a := range t.Artifacts {
		if a.ID == r.PathValue("artifact") {
			a.ZIP = nil
			respond(w, 200, a)
			return
		}
	}
}
func (s *Server) previewFile(w http.ResponseWriter, r *http.Request) {
	t, e := s.Service.Store.FindArtifact(r.PathValue("artifact"))
	if e != nil {
		fail(w, e, 404)
		return
	}
	for _, a := range t.Artifacts {
		if a.ID == r.PathValue("artifact") {
			for _, f := range a.Files {
				if f.ID == r.PathValue("file") {
					w.Header().Set("Content-Type", "text/plain; charset=utf-8")
					w.Header().Set("Content-Disposition", `inline; filename="preview.txt"`)
					w.Write(f.Bytes)
					return
				}
			}
		}
	}
	fail(w, errors.New("NOT_FOUND"), 404)
}
func (s *Server) valid(t domain.Task, hash string) error {
	a := t.Artifact()
	if a == nil || a.Revision != t.Revision || a.SetHash != hash || (a.Status != "ready" && a.Status != "finalized") {
		return errors.New("ARTIFACT_STALE")
	}
	rules, e := s.Service.Store.Rules()
	if e != nil {
		return e
	}
	p, e := policy.Pack(t, rules, time.Now())
	if e != nil {
		return e
	}
	p.ToolResults = a.Pack.ToolResults
	if string(domain.Canonical(p)) != string(domain.Canonical(a.Pack)) {
		return errors.New("FINALIZATION_BLOCKED")
	}
	for _, c := range t.Candidates {
		if d, ok := t.Decisions[c.ID]; ok && d.Disposition == "allow" {
			if e = domain.ValidateEvidence(t, c.EvidenceIDs); e != nil {
				return e
			}
		}
	}
	if e = artifact.Check(*a); e != nil {
		return e
	}
	doc, files := false, false
	for _, rev := range a.Reviews {
		if rev.Result == "pass" {
			doc = doc || rev.TargetKind == "document" && rev.TargetHash == a.DocumentHash
			files = files || rev.TargetKind == "files" && rev.TargetHash == a.SetHash
		}
	}
	if !doc || !files {
		return errors.New("FINALIZATION_BLOCKED")
	}
	return nil
}
func (s *Server) finalize(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Revision  int    `json:"expected_revision"`
		Hash      string `json:"expected_artifact_set_hash"`
		Confirmed bool   `json:"confirmed"`
	}
	if e := decode(r, &v); e != nil {
		fail(w, e, 400)
		return
	}
	s.Service.Store.Mu.Lock()
	defer s.Service.Store.Mu.Unlock()
	t, e := s.Service.Store.FindArtifact(r.PathValue("artifact"))
	if e != nil {
		fail(w, e, 404)
		return
	}
	if t.Revision != v.Revision || t.CurrentArtifactID != r.PathValue("artifact") || !v.Confirmed {
		fail(w, errors.New("FINALIZATION_BLOCKED"), 409)
		return
	}
	if e = s.valid(t, v.Hash); e != nil {
		fail(w, e, 409)
		return
	}
	t.Artifact().Status = "finalized"
	t.Phase = "finalized"
	t.ExportID = domain.ID("export")
	t.Event("export.finalized")
	if e = s.Service.Store.Save(t, t.Revision); e != nil {
		fail(w, e, 409)
		return
	}
	respond(w, 201, map[string]string{"export_id": t.ExportID, "archive_sha256": t.Artifact().ZIPHash})
}
func (s *Server) download(w http.ResponseWriter, r *http.Request) {
	t, e := s.Service.Store.FindExport(r.PathValue("export"))
	if e != nil {
		fail(w, errors.New("EXPORT_INVALIDATED"), 409)
		return
	}
	a := t.Artifact()
	if a == nil || t.Phase != "finalized" {
		fail(w, errors.New("EXPORT_INVALIDATED"), 409)
		return
	}
	if e = s.valid(t, a.SetHash); e != nil {
		fail(w, errors.New("EXPORT_INVALIDATED"), 409)
		return
	}
	if id := r.PathValue("file"); id != "" {
		for _, f := range a.Files {
			if f.ID == id {
				w.Header().Set("Content-Type", f.MediaType)
				w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, f.Path))
				w.Write(f.Bytes)
				return
			}
		}
		fail(w, errors.New("REFERENCE_INVALID"), 404)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="safehandoff-public.zip"`)
	w.Write(a.ZIP)
}
func (s *Server) edit(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Revision int          `json:"expected_revision"`
		Hash     string       `json:"expected_document_hash"`
		Document domain.Draft `json:"document"`
	}
	if e := decode(r, &v); e != nil {
		fail(w, e, 400)
		return
	}
	s.Service.Store.Mu.Lock()
	defer s.Service.Store.Mu.Unlock()
	t, e := s.Service.Store.FindArtifact(r.PathValue("artifact"))
	if e != nil {
		fail(w, e, 404)
		return
	}
	a := t.Artifact()
	if t.Revision != v.Revision || a == nil || a.ID != r.PathValue("artifact") || a.DocumentHash != v.Hash {
		fail(w, errors.New("ARTIFACT_STALE"), 409)
		return
	}
	old := t.Revision
	pack := a.Pack
	pack.Revision = old + 1
	ar, e := artifact.Build(v.Document, pack)
	if e != nil {
		fail(w, e, 400)
		return
	}
	t.Invalidate("needs_attention")
	ar.Status = "draft"
	t.Artifacts = append(t.Artifacts, ar)
	t.CurrentArtifactID = ar.ID
	if e = s.Service.Store.Save(t, old); e != nil {
		fail(w, e, 409)
		return
	}
	respond(w, 200, ar)
}
func (s *Server) humanReview(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Revision  int    `json:"expected_revision"`
		Hash      string `json:"expected_artifact_set_hash"`
		Reason    string `json:"fallback_reason"`
		Confirmed bool   `json:"confirmed"`
	}
	if e := decode(r, &v); e != nil {
		fail(w, e, 400)
		return
	}
	s.Service.Store.Mu.Lock()
	defer s.Service.Store.Mu.Unlock()
	t, e := s.Service.Store.FindArtifact(r.PathValue("artifact"))
	if e != nil {
		fail(w, e, 404)
		return
	}
	a := t.Artifact()
	if a == nil || a.ID != r.PathValue("artifact") || t.Revision != v.Revision || a.SetHash != v.Hash || !v.Confirmed || v.Reason == "" {
		fail(w, errors.New("FINALIZATION_BLOCKED"), 409)
		return
	}
	// Test hard checks with proposed hash-bound human reviews before persisting.
	a.Reviews = append(a.Reviews, domain.Review{ID: domain.ID("review"), TargetKind: "document", TargetHash: a.DocumentHash, Mode: "human", Result: "pass", FallbackReason: v.Reason}, domain.Review{ID: domain.ID("review"), TargetKind: "files", TargetHash: a.SetHash, Mode: "human", Result: "pass", FallbackReason: v.Reason})
	a.Status = "ready"
	if e = s.valid(t, a.SetHash); e != nil {
		fail(w, e, 409)
		return
	}
	t.Phase = "ready_to_finalize"
	t.Event("review.completed")
	if e = s.Service.Store.Save(t, t.Revision); e != nil {
		fail(w, e, 409)
		return
	}
	respond(w, 200, a)
}

func (s *Server) rules(w http.ResponseWriter, r *http.Request) {
	rules, e := s.Service.Store.Rules()
	if e != nil {
		fail(w, e, 500)
		return
	}
	respond(w, 200, rules)
}
func (s *Server) revokeRule(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Version int `json:"expected_rule_version"`
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
	found := false
	for _, rule := range rules {
		if rule.ID == r.PathValue("rule") && rule.Version == v.Version {
			rule.Revoked = true
			found = true
			if e = s.Service.Store.PutRule(rule); e != nil {
				fail(w, e, 500)
				return
			}
		}
	}
	if !found {
		fail(w, errors.New("REFERENCE_INVALID"), 404)
		return
	}
	ts, e := s.Service.Store.List()
	if e != nil {
		fail(w, e, 500)
		return
	}
	for _, t := range ts {
		for _, d := range t.Decisions {
			if d.RuleID == r.PathValue("rule") {
				old := t.Revision
				t.Invalidate("needs_decisions")
				if e = s.Service.Store.Save(t, old); e != nil {
					fail(w, e, 500)
					return
				}
				break
			}
		}
	}
	respond(w, 200, map[string]bool{"revoked": true})
}
