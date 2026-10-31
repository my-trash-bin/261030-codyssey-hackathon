package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/llm"
	"strings"
	"sync"
	"testing"
	"time"
)

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
	v := map[string]any{"internal_title": "x", "project_id": "project_demo", "purpose_id": "vendor_support", "recipient_id": "recipient_vendorstore", "audience": "named_external", "output_language": "ko", "skill_ids": []string{}}
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
	newRecipient := payload[map[string]string](t, h.req("POST", "/catalog/recipients", map[string]string{"display_name": "새 시험 수신자"}, "recipient"))["id"]
	w = h.req("PATCH", "/tasks/"+id, map[string]any{"expected_revision": task.Revision, "recipient_id": newRecipient}, "scope")
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

func TestHumanReviewCannotBypassHardChecks(t *testing.T) {
	h := newHarness(t)
	id := h.task("b2b-timeout", "vendor_support")
	h.decisions(id, "direction", false)
	h.job(id, "compose")
	task := h.get(id)
	a := task.Artifact()
	a.Reviews = nil
	a.Status = "blocked"
	task.Phase = "needs_attention"
	h.db.Save(task, task.Revision)
	body := map[string]any{"expected_revision": task.Revision, "expected_artifact_set_hash": a.SetHash, "fallback_reason": "실제 파일의 미확인 사항과 공개 범위를 사람이 확인함", "confirmed": true}
	w := h.req("POST", "/artifacts/"+a.ID+"/human-review", body, "human1")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	task = h.get(id)
	a = task.Artifact()
	if len(a.Reviews) != 2 || a.Reviews[0].Mode != "human" {
		t.Fatal(a.Reviews)
	}
	a.Files[0].Bytes[0] ^= 1
	h.db.Save(task, task.Revision)
	w = h.req("POST", "/artifacts/"+a.ID+"/human-review", body, "human2")
	if w.Code != 409 {
		t.Fatal("bypassed hard check", w.Code)
	}
}
func TestRawExcerptAPIAndWriterIsolation(t *testing.T) {
	h := newHarness(t)
	id := h.task("oss-encoding", "oss_issue")
	task := h.get(id)
	var c domain.Candidate
	for _, v := range task.Candidates {
		if strings.Contains(v.Statement, "E_ENCODE") {
			c = v
			break
		}
	}
	var ev domain.Evidence
	for _, v := range task.Evidence {
		if v.ID == c.EvidenceIDs[0] {
			ev = v
		}
	}
	var src domain.Source
	for _, v := range task.Sources {
		if v.ID == ev.SourceVersionID {
			src = v
		}
	}
	raw := src.Raw[ev.Start:ev.End]
	grant := domain.RawGrant{SourceVersionID: src.ID, SourceSHA: src.SHA, Range: domain.ByteRange{Start: ev.Start, End: ev.End}, Hidden: []domain.ByteRange{}, RenderedSHA: domain.Hash(raw), Scope: task.Scope}
	r := domain.Representation{Kind: "approved_excerpt", Parameters: map[string]int{}}
	p := payload[domain.Preview](t, h.req("POST", "/tasks/"+id+"/disclosure-previews", map[string]any{"expected_revision": task.Revision, "candidate_id": c.ID, "representation": r, "raw_grants": []domain.RawGrant{grant}}, "raw-preview"))
	ops := []map[string]any{}
	for _, candidate := range task.Candidates {
		if candidate.ID == c.ID {
			ops = append(ops, map[string]any{"candidate_id": c.ID, "disposition": "allow", "representation": r, "raw_grants": []domain.RawGrant{grant}, "preview_id": p.ID, "projection_sha256": p.SHA})
		} else {
			ops = append(ops, map[string]any{"candidate_id": candidate.ID, "disposition": "exclude"})
		}
	}
	payload[map[string]any](t, h.req("POST", "/tasks/"+id+"/decision-batches", map[string]any{"expected_revision": task.Revision, "operations": ops}, "raw-decisions"))
	current := h.get(id)
	reduced := payload[domain.Task](t, h.req("PATCH", "/tasks/"+id, map[string]any{"expected_revision": current.Revision, "scope_reduced": true}, "reduce-raw-scope"))
	if reduced.Phase != "ready_to_generate" {
		t.Fatal(reduced.Phase)
	}
	h.job(id, "compose")
	h.finalize(id)
	task = h.get(id)
	found := false
	for _, f := range task.Artifact().Files {
		if f.Path == "approved-excerpt.txt" {
			found = true
			if !bytes.Equal(f.Bytes, raw) {
				t.Fatal("excerpt changed")
			}
		}
	}
	if !found {
		t.Fatal("missing excerpt")
	}
	for _, tr := range task.Traces {
		if tr.Role == "writer" && bytes.Contains(tr.Request, []byte("source_version_id")) {
			t.Fatal("raw provenance leaked into writer")
		}
	}
}
func TestInterpretationIsProposalNotApproval(t *testing.T) {
	h := newHarness(t)
	id := h.task("internal-operations", "operations_advice")
	task := h.get(id)
	var c domain.Candidate
	for _, candidate := range task.Candidates {
		if candidate.Kind == "series" {
			c = candidate
		}
	}
	j := payload[domain.Job](t, h.req("POST", "/tasks/"+id+"/jobs", map[string]any{"expected_revision": task.Revision, "kind": "interpret_disclosure", "arguments": map[string]any{"candidate_id": c.ID, "text": "첫 관찰을 100으로 한 비율만 공개"}}, "interpret"))
	for i := 0; i < 100; i++ {
		next := h.get(id)
		for _, job := range next.Jobs {
			if job.ID == j.ID && job.Status == "succeeded" {
				var result llm.Disclosure
				if json.Unmarshal(job.Result, &result) != nil || result.Status != "supported" {
					t.Fatal(string(job.Result))
				}
				if len(next.Decisions) != 0 || next.Revision != task.Revision {
					t.Fatal("proposal changed permissions")
				}
				return
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("interpretation did not complete")
}

type fakeChatTransport func(*http.Request) (*http.Response, error)

func (f fakeChatTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestWriterSerializedHTTPPayloadBoundary(t *testing.T) {
	h := newHarness(t)
	t.Setenv("SAFEHANDOFF_LLM_BASE_URL", "https://fake-endpoint.invalid/v1")
	t.Setenv("SAFEHANDOFF_LLM_MODEL", "wire-contract-test")
	p, e := llm.NewLive(llm.DefaultConfig())
	if e != nil {
		t.Fatal(e)
	}
	var captured [][]byte
	var mu sync.Mutex
	p.Client.Transport = fakeChatTransport(func(req *http.Request) (*http.Response, error) {
		b, e := io.ReadAll(req.Body)
		if e != nil {
			return nil, e
		}
		var body struct {
			Messages []llm.Message `json:"messages"`
		}
		if e = json.Unmarshal(b, &body); e != nil {
			return nil, e
		}
		role := ""
		prompt := body.Messages[0].Content
		switch {
		case strings.Contains(prompt, "당신은 분석기"):
			role = "analyst"
		case strings.Contains(prompt, "당신은 공개 작성기"):
			role = "writer"
		case strings.Contains(prompt, "당신은 내부 검토기"):
			role = "reviewer"
		default:
			return nil, fmt.Errorf("unknown test role")
		}
		if role == "writer" {
			mu.Lock()
			captured = append(captured, append([]byte{}, b...))
			mu.Unlock()
		}
		res, e := llm.Fixture{}.Generate(req.Context(), llm.Request{Role: role, Messages: body.Messages})
		if e != nil {
			return nil, e
		}
		wire := domain.Canonical(map[string]any{"choices": []map[string]any{{"finish_reason": "stop", "message": map[string]string{"content": res.Text}}}})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(wire)), Header: http.Header{}}, nil
	})
	h.svc.Provider = p
	id := h.task("b2b-timeout", "vendor_support")
	h.decisions(id, "direction", false)
	h.job(id, "compose")
	mu.Lock()
	defer mu.Unlock()
	if len(captured) != 1 {
		t.Fatal("missing actual serialized writer request", len(captured))
	}
	for _, bad := range []string{"DEMO_ONLY_SECRET", "INTERNAL_TITLE_CANARY", "client-log.txt", "raw_bytes", "source_version_id", "192.0.2.17", "internal_explanation"} {
		if bytes.Contains(captured[0], []byte(bad)) {
			t.Fatalf("writer HTTP body contains %s", bad)
		}
	}
	if !bytes.Contains(captured[0], []byte("op_demo_007")) {
		t.Fatal("approved ID was discarded")
	}
}

type needsDecisionProvider struct{}

func (needsDecisionProvider) Mode() string { return "fixture" }
func (needsDecisionProvider) Generate(ctx context.Context, r llm.Request) (llm.Response, error) {
	if r.Role != "reviewer" {
		return llm.Fixture{}.Generate(ctx, r)
	}
	var payload struct {
		Decisions map[string]domain.Decision `json:"decisions"`
	}
	if e := json.Unmarshal([]byte(r.Messages[len(r.Messages)-1].Content), &payload); e != nil {
		return llm.Response{}, e
	}
	for id := range payload.Decisions {
		action := "request_decision"
		review := llm.Review{Schema: "review.v1", Result: "needs_decision", Issues: []llm.Issue{{Target: llm.Target{Kind: "document"}, Reason: "NEEDS_DISCLOSURE_DECISION", Action: &action, Facts: []string{}, Candidates: []string{id}, Explanation: "REVIEW_ONLY_DO_NOT_FORWARD"}}}
		return llm.Response{Text: string(domain.Canonical(review))}, nil
	}
	return llm.Response{}, fmt.Errorf("test has no decision")
}
func TestReviewDecisionRequestBlocksUntilExplicitChoice(t *testing.T) {
	h := newHarness(t)
	id := h.task("b2b-timeout", "vendor_support")
	h.decisions(id, "direction", false)
	h.svc.Provider = needsDecisionProvider{}
	task := h.get(id)
	job := payload[domain.Job](t, h.req("POST", "/tasks/"+id+"/jobs", map[string]any{"expected_revision": task.Revision, "kind": "compose"}, "needs-choice"))
	done := false
	for i := 0; i < 100; i++ {
		task = h.get(id)
		for _, j := range task.Jobs {
			if j.ID == job.ID && j.Status == "failed" {
				done = true
			}
		}
		if done {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !done || len(task.PendingDecisionIDs) != 1 || task.Phase != "needs_decisions" {
		t.Fatal("decision request not retained", task.Phase, task.PendingDecisionIDs)
	}
	if w := h.req("POST", "/tasks/"+id+"/jobs", map[string]any{"expected_revision": task.Revision, "kind": "compose"}, "premature"); w.Code != 409 {
		t.Fatal("pending choice bypassed", w.Code)
	}
	h.decisions(id, "direction", false)
	h.svc.Provider = llm.Fixture{}
	h.job(id, "compose")
	task = h.get(id)
	if len(task.PendingDecisionIDs) != 0 {
		t.Fatal(task.PendingDecisionIDs)
	}
	for _, trace := range task.Traces {
		if trace.Role == "writer" && bytes.Contains(trace.Request, []byte("REVIEW_ONLY_DO_NOT_FORWARD")) {
			t.Fatal("review explanation reached writer")
		}
	}
}
func TestProcessingCannotFinalizeOrHumanApproveOldFiles(t *testing.T) {
	h := newHarness(t)
	id := h.task("b2b-timeout", "vendor_support")
	h.decisions(id, "direction", false)
	h.job(id, "compose")
	task := h.get(id)
	a := task.Artifact()
	task.Phase = "processing"
	h.db.Save(task, task.Revision)
	w := h.req("POST", "/artifacts/"+a.ID+"/finalize", map[string]any{"expected_revision": task.Revision, "expected_artifact_set_hash": a.SetHash, "confirmed": true}, "processing-finalize")
	if w.Code != 409 {
		t.Fatal("processing finalize accepted", w.Code)
	}
	a.Status = "blocked"
	h.db.Save(task, task.Revision)
	w = h.req("POST", "/artifacts/"+a.ID+"/human-review", map[string]any{"expected_revision": task.Revision, "expected_artifact_set_hash": a.SetHash, "fallback_reason": "동시 실행 이전 파일 확인", "confirmed": true}, "processing-human")
	if w.Code != 409 {
		t.Fatal("processing human review accepted", w.Code)
	}
}
func TestCompletedJobCannotDowngradeFinalizedTask(t *testing.T) {
	h := newHarness(t)
	id := h.task("b2b-timeout", "vendor_support")
	h.decisions(id, "direction", false)
	h.job(id, "compose")
	export := h.finalize(id)
	task := h.get(id)
	w := h.req("POST", "/jobs/"+task.CurrentJobID+"/cancel", map[string]any{"expected_revision": task.Revision}, "cancel-finished")
	if w.Code != 409 {
		t.Fatal("finished job cancelled", w.Code)
	}
	w = h.req("POST", "/tasks/"+id+"/jobs", map[string]any{"expected_revision": task.Revision, "kind": "review"}, "review-final")
	if w.Code != 409 {
		t.Fatal("finalized document reviewed without new revision", w.Code)
	}
	task = h.get(id)
	if task.Phase != "finalized" || task.ExportID != export {
		t.Fatal("finalization changed")
	}
}
