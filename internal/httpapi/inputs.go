package httpapi

import (
	"errors"
	"io"
	"net/http"
	"safehandoff.local/poc/internal/domain"
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
	if len(meta.Items) == 0 || len(meta.Items) > s.Service.MaxFiles {
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
		b, e := io.ReadAll(io.LimitReader(f, int64(s.Service.MaxFileBytes+1)))
		f.Close()
		if e != nil {
			fail(w, e, 400)
			return
		}
		if len(b) > s.Service.MaxFileBytes {
			fail(w, errors.New("INPUT_TOO_LARGE"), 413)
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
	if total > s.Service.MaxSourceBytes || count > s.Service.MaxFiles {
		fail(w, errors.New("INPUT_TOO_LARGE"), 413)
		return
	}
	t.ScopeReduced = false
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
	t.ScopeReduced = false
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
			w.Header().Set("Content-Disposition", `inline; filename="source-preview.txt"`)
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
