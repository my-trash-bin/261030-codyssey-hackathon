package httpapi

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/llm"
	"safehandoff.local/poc/internal/store"
	"safehandoff.local/poc/internal/workflow"
	"strings"
	"testing"
	"time"
)

type harness struct {
	t   *testing.T
	s   *Server
	db  *store.Store
	svc *workflow.Service
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	db, e := store.Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	svc := workflow.New(db, llm.Fixture{})
	s := New(svc, "127.0.0.1:8080")
	h := &harness{t, s, db, svc}
	t.Cleanup(func() { svc.Close(); db.Close() })
	return h
}
func (h *harness) req(method, path string, v any, key string) *httptest.ResponseRecorder {
	h.t.Helper()
	var b []byte
	if v != nil {
		b = domain.Canonical(v)
	}
	return h.raw(method, path, b, "application/json", key)
}
func (h *harness) raw(method, path string, b []byte, content, key string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://127.0.0.1:8080/api/v1"+path, bytes.NewReader(b))
	r.Header.Set("Content-Type", content)
	r.Header.Set("X-CSRF-Token", h.s.Token)
	r.Header.Set("Idempotency-Key", key)
	r.Header.Set("Cookie", "safehandoff_session="+h.s.Session)
	w := httptest.NewRecorder()
	h.s.ServeHTTP(w, r)
	return w
}
func payload[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	if w.Code >= 400 {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	var v struct {
		Data T `json:"data"`
	}
	if e := json.Unmarshal(w.Body.Bytes(), &v); e != nil {
		t.Fatal(e)
	}
	return v.Data
}
func (h *harness) get(id string) domain.Task {
	h.t.Helper()
	v, e := h.db.Get(id)
	if e != nil {
		h.t.Fatal(e)
	}
	return v
}
func (h *harness) job(id, kind string) {
	h.t.Helper()
	t := h.get(id)
	w := h.req("POST", "/tasks/"+id+"/jobs", map[string]any{"expected_revision": t.Revision, "kind": kind}, domain.ID("key"))
	j := payload[domain.Job](h.t, w)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		t = h.get(id)
		for _, v := range t.Jobs {
			if v.ID == j.ID {
				if v.Status == "succeeded" {
					return
				}
				if v.Status == "failed" || v.Status == "stale" {
					h.t.Fatalf("job %s %s: %s", kind, v.Status, v.Error)
				}
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	h.t.Fatal("job timeout")
}
func (h *harness) task(scenario, purpose string) string {
	h.t.Helper()
	v := payload[domain.Task](h.t, h.req("POST", "/tasks", map[string]any{"internal_title": "INTERNAL_TITLE_CANARY", "project_id": "project_demo", "purpose_id": purpose, "recipient_id": "recipient_vendorstore", "audience": "named_external", "output_language": "ko", "skill_ids": []string{}}, domain.ID("key")))
	var b bytes.Buffer
	mw := multipart.NewWriter(&b)
	entries, e := os.ReadDir("../../fixtures/author/" + scenario)
	if e != nil {
		h.t.Fatal(e)
	}
	items := []map[string]string{}
	for i, en := range entries {
		key := fmt.Sprint("file", i)
		f, e := mw.CreateFormFile(key, en.Name())
		if e != nil {
			h.t.Fatal(e)
		}
		raw, e := os.ReadFile("../../fixtures/author/" + scenario + "/" + en.Name())
		if e != nil {
			h.t.Fatal(e)
		}
		f.Write(raw)
		format := strings.TrimPrefix(filepath.Ext(en.Name()), ".")
		items = append(items, map[string]string{"client_key": key, "display_name": en.Name(), "format": format, "source_slot": "requests_v1"})
	}
	mw.WriteField("meta", string(domain.Canonical(map[string]any{"expected_revision": v.Revision, "items": items})))
	mw.Close()
	w := h.raw("POST", "/tasks/"+v.ID+"/source-batches", b.Bytes(), mw.FormDataContentType(), domain.ID("key"))
	if w.Code != 201 {
		h.t.Fatal(w.Body.String())
	}
	h.job(v.ID, "analyze")
	return v.ID
}
func (h *harness) decisions(id, volume string, reuse bool) {
	h.t.Helper()
	t := h.get(id)
	ops := []map[string]any{}
	for _, c := range t.Candidates {
		r := domain.Representation{Kind: "fact_summary", Parameters: map[string]int{}}
		if c.Kind == "identifier" {
			r.Kind = "exact_value"
		}
		if c.Kind == "series" {
			switch volume {
			case "direction":
				r.Kind = "derived_table"
				r.TransformID = "series_direction_only.v1"
			case "ratio":
				r.Kind = "derived_table"
				r.TransformID = "series_index_base100.v1"
				r.Parameters["decimal_places"] = 2
			case "exact":
				r.Kind = "exact_value"
			}
		}
		p := payload[domain.Preview](h.t, h.req("POST", "/tasks/"+id+"/disclosure-previews", map[string]any{"expected_revision": t.Revision, "candidate_id": c.ID, "representation": r}, domain.ID("key")))
		ops = append(ops, map[string]any{"candidate_id": c.ID, "disposition": "allow", "representation": r, "preview_id": p.ID, "projection_sha256": p.SHA, "save_reusable_rule": reuse && c.Kind == "series"})
	}
	payload[map[string]any](h.t, h.req("POST", "/tasks/"+id+"/decision-batches", map[string]any{"expected_revision": t.Revision, "operations": ops}, domain.ID("key")))
}
func (h *harness) finalize(id string) string {
	h.t.Helper()
	t := h.get(id)
	a := t.Artifact()
	if a == nil {
		h.t.Fatal("no artifact")
	}
	v := payload[map[string]string](h.t, h.req("POST", "/artifacts/"+a.ID+"/finalize", map[string]any{"expected_revision": t.Revision, "expected_artifact_set_hash": a.SetHash, "confirmed": true}, domain.ID("key")))
	return v["export_id"]
}
func TestEndToEndDisclosureBytesAndInvalidation(t *testing.T) {
	h := newHarness(t)
	id := h.task("b2b-timeout", "vendor_support")
	h.decisions(id, "ratio", false)
	h.job(id, "compose")
	old := h.finalize(id)
	h.decisions(id, "direction", true)
	if w := h.req("GET", "/exports/"+old+"/archive", nil, ""); w.Code != 409 {
		t.Fatal(w.Code)
	}
	h.job(id, "compose")
	export := h.finalize(id)
	w := h.req("GET", "/exports/"+export+"/archive", nil, "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	task := h.get(id)
	if !bytes.Equal(w.Body.Bytes(), task.Artifact().ZIP) {
		t.Fatal("not stored bytes")
	}
	z, e := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if e != nil {
		t.Fatal(e)
	}
	bundle := ""
	for _, f := range z.File {
		r, e := f.Open()
		if e != nil {
			t.Fatal(e)
		}
		b, _ := io.ReadAll(r)
		r.Close()
		bundle += string(b)
		for _, s := range []string{"DEMO_ONLY_SECRET", "DEMO_CUSTOMER", "INTERNAL_TITLE_CANARY", "2026-04-21", "requests_per_minute", "141.46"} {
			if bytes.Contains(b, []byte(s)) {
				t.Errorf("unapproved %s in %s", s, f.Name)
			}
		}
	}
	if !strings.Contains(bundle, "op_demo_007") || !strings.Contains(bundle, "att_demo_01") || !strings.Contains(bundle, "確認") && !strings.Contains(bundle, "확인하지 못") {
		t.Fatal(bundle)
	}
	for _, tr := range task.Traces {
		if tr.Role == "writer" {
			for _, bad := range []string{"DEMO_ONLY_SECRET", "INTERNAL_TITLE_CANARY", "raw_bytes", "client-log.txt", "192.0.2.17"} {
				if bytes.Contains(tr.Request, []byte(bad)) {
					t.Errorf("writer received %s", bad)
				}
			}
		}
	}
	t.Log("actual ZIP SHA256", domain.Hash(w.Body.Bytes()))
}
func TestIdempotencyAndCSRF(t *testing.T) {
	h := newHarness(t)
	v := map[string]any{"internal_title": "x", "project_id": "p", "purpose_id": "vendor_support", "recipient_id": "r", "audience": "named_external", "output_language": "ko", "skill_ids": []string{}}
	a := h.req("POST", "/tasks", v, "same")
	b := h.req("POST", "/tasks", v, "same")
	if a.Body.String() != b.Body.String() {
		t.Fatal("duplicate applied")
	}
	v["internal_title"] = "other"
	if w := h.req("POST", "/tasks", v, "same"); w.Code != 409 {
		t.Fatal(w.Code)
	}
	r := httptest.NewRequest("POST", "http://127.0.0.1:8080/api/v1/tasks", strings.NewReader("{}"))
	w := httptest.NewRecorder()
	h.s.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
	r = httptest.NewRequest("GET", "http://evil.test/api/v1/tasks", nil)
	w = httptest.NewRecorder()
	h.s.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
}
func TestFinalByteTamperAndScope(t *testing.T) {
	h := newHarness(t)
	id := h.task("internal-operations", "operations_advice")
	h.decisions(id, "direction", false)
	h.job(id, "compose")
	task := h.get(id)
	a := task.Artifact()
	a.Files[0].Bytes[0] ^= 1
	if e := h.db.Save(task, task.Revision); e != nil {
		t.Fatal(e)
	}
	w := h.req("POST", "/artifacts/"+a.ID+"/finalize", map[string]any{"expected_revision": task.Revision, "expected_artifact_set_hash": a.SetHash, "confirmed": true}, "tamper")
	if w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	w = h.req("PATCH", "/tasks/"+id, map[string]any{"expected_revision": task.Revision, "recipient_id": "changed"}, "scope")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	task = h.get(id)
	if task.CurrentArtifactID != "" || task.Phase != "needs_decisions" {
		t.Fatal(task.Phase)
	}
	if w = h.req("POST", "/tasks/"+id+"/jobs", map[string]any{"expected_revision": task.Revision, "kind": "compose"}, "blocked"); w.Code != 409 {
		t.Fatal(w.Code)
	}
}
func TestReuseAndRevocation(t *testing.T) {
	h := newHarness(t)
	id := h.task("internal-operations", "operations_advice")
	h.decisions(id, "direction", true)
	next := h.task("internal-operations", "operations_advice")
	task := h.get(next)
	count := 0
	for _, c := range task.Candidates {
		if c.Kind == "series" {
			d, ok := task.Decisions[c.ID]
			if !ok || d.RuleID == "" {
				t.Fatal("rule not reused")
			}
			count++
		}
	}
	if count != 1 {
		t.Fatal(count)
	}
	rules, e := h.db.Rules()
	if e != nil || len(rules) != 1 {
		t.Fatal(rules, e)
	}
	w := h.req("POST", "/rules/"+rules[0].ID+"/revoke", map[string]int{"expected_rule_version": 1}, "revoke")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	changed := h.get(next)
	if changed.Revision <= task.Revision {
		t.Fatal("dependent task not invalidated")
	}
}
