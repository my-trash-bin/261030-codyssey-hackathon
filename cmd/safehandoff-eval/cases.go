package main

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/httpapi"
	"safehandoff.local/poc/internal/llm"
	"safehandoff.local/poc/internal/policy"
	"safehandoff.local/poc/internal/store"
	"safehandoff.local/poc/internal/workflow"
	"strings"
)

func runCase(p llm.Provider, scenario, purpose, volume string, ids bool, out string, latestOut string) (res caseResult) {
	res.CaseID = scenario + "-" + volume
	if !ids {
		res.CaseID += "-ids-excluded"
	}
	res.Status = "fail"
	res.SourceHashes = map[string]string{}
	expectedBytes, err := os.ReadFile(filepath.Join("evaluation/expected", res.CaseID+".json"))
	var expected expectedCase
	if err != nil || domain.Strict(expectedBytes, &expected) != nil || expected.Schema != "evaluation_case.v1" || expected.ID != res.CaseID {
		res.Error = "EVALUATION_EXPECTED_INVALID"
		return
	}
	res.ExpectedSHA = domain.Hash(expectedBytes)
	dir, e := os.MkdirTemp("", "safehandoff-eval-")
	if e != nil {
		res.Error = e.Error()
		return
	}
	defer os.RemoveAll(dir)
	db, e := store.Open(dir)
	if e != nil {
		res.Error = e.Error()
		return
	}
	defer db.Close()
	svc := workflow.New(db, p)
	if live, ok := p.(*llm.Live); ok {
		svc.MaxInput = live.Config.MaxInput
		svc.Attempts = live.Config.MaxAttempts
	}
	defer svc.Close()
	scope := domain.Scope{ProjectID: "project_demo", PurposeID: purpose, RecipientID: "recipient_vendorstore", Audience: "named_external"}
	if purpose == "oss_issue" {
		scope.RecipientID = "public"
		scope.Audience = "public"
	}
	if purpose == "operations_advice" {
		scope.RecipientID = domain.ID("recipient")
		if _, e = db.DB.Exec("INSERT INTO catalog VALUES(?,?,?)", scope.RecipientID, "recipient", "가상 운영 자문사"); e != nil {
			res.Error = e.Error()
			return
		}
	}
	task, e := svc.Create("가상 평가 내부 작업", scope, "ko")
	if e != nil {
		res.Error = e.Error()
		return
	}
	res.Scope = task.Scope
	defer func() {
		current, err := db.Get(task.ID)
		if err != nil {
			return
		}
		res.ModelCalls = len(current.Traces)
		res.Repro = current.Reproduction
		os.MkdirAll(out, 0700)
		trace, _ := json.MarshalIndent(current.Traces, "", "  ")
		os.WriteFile(filepath.Join(out, res.CaseID+"-internal-traces.json"), append(trace, '\n'), 0600)
	}()

	entries, e := os.ReadDir("fixtures/author/" + scenario)
	if e != nil {
		res.Error = e.Error()
		return
	}
	for _, en := range entries {
		b, e := os.ReadFile("fixtures/author/" + scenario + "/" + en.Name())
		if e != nil {
			res.Error = e.Error()
			return
		}
		src := domain.Source{ID: domain.ID("srcv"), SourceID: domain.ID("source"), Version: 1, Name: en.Name(), Format: strings.TrimPrefix(filepath.Ext(en.Name()), "."), Slot: "requests_v1", Raw: b, SHA: domain.Hash(b), Included: true}
		task.Sources = append(task.Sources, src)
		task.Evidence = append(task.Evidence, domain.EvidenceFor(src)...)
		res.SourceHashes[en.Name()] = src.SHA
	}
	task.Invalidate("needs_analysis")
	if e = db.Save(task, 1); e != nil {
		res.Error = e.Error()
		return
	}
	j, e := svc.Start(task.ID, task.Revision, "analyze")
	if e == nil {
		e = wait(db, task.ID, j.ID)
	}
	if e != nil {
		res.Error = e.Error()
		return
	}
	task, e = db.Get(task.ID)
	if e != nil {
		res.Error = e.Error()
		return
	}
	old := task.Revision
	for _, c := range task.Candidates {
		d := domain.Decision{ID: domain.ID("dec"), CandidateID: c.ID, Disposition: "allow", Scope: task.Scope, SourceHash: task.SourceHash(), Representation: domain.Representation{Kind: "fact_summary", Parameters: map[string]int{}}}
		if !c.Required && c.Kind != "identifier" && c.Kind != "synthetic" && c.Kind != "series" {
			d.Disposition = "exclude"
		}
		if c.Kind == "config_example" {
			d.Disposition = "exclude"
		}
		if c.Kind == "identifier" {
			if !ids {
				d.Disposition = "exclude"
			} else {
				d.Representation.Kind = "exact_value"
			}
		}
		if c.Kind == "series" {
			d.Representation.Kind = "derived_table"
			d.Representation.TransformID = "series_direction_only.v1"
			if volume == "ratio" {
				d.Representation.TransformID = "series_index_base100.v1"
				d.Representation.Parameters["decimal_places"] = 2
			}
		}
		pr, e := policy.Project(c, d.Representation)
		if e != nil {
			res.Error = e.Error()
			return
		}
		d.ProjectionSHA = domain.Hash(domain.Canonical(pr))
		task.Decisions[c.ID] = d
	}
	task.Invalidate("ready_to_generate")
	if e = db.Save(task, old); e != nil {
		res.Error = e.Error()
		return
	}
	j, e = svc.Start(task.ID, task.Revision, "compose")
	if e == nil {
		e = wait(db, task.ID, j.ID)
	}
	if e != nil {
		res.Error = e.Error()
		return
	}
	task, e = db.Get(task.ID)
	if e != nil {
		res.Error = e.Error()
		return
	}
	a := task.Artifact()
	if a == nil {
		res.Error = "NO_ARTIFACT"
		return
	}
	server := httpapi.New(svc, "127.0.0.1:8080")
	body := domain.Canonical(map[string]any{"expected_revision": task.Revision, "expected_artifact_set_hash": a.SetHash, "confirmed": true})
	req := httptest.NewRequest("POST", "http://127.0.0.1:8080/api/v1/artifacts/"+a.ID+"/finalize", bytes.NewReader(body))
	req.Header.Set("X-CSRF-Token", server.Token)
	req.Header.Set("Cookie", "safehandoff_session="+server.Session)
	req.Header.Set("Idempotency-Key", domain.ID("key"))
	rec := httptest.NewRecorder()
	server.ServeHTTP(rec, req)
	if rec.Code != 201 {
		res.Error = rec.Body.String()
		return
	}
	task, _ = db.Get(task.ID)
	a = task.Artifact()
	export := httptest.NewRequest("GET", "http://127.0.0.1:8080/api/v1/exports/"+task.ExportID+"/archive", nil)
	rec = httptest.NewRecorder()
	server.ServeHTTP(rec, export)
	if rec.Code != 200 || !bytes.Equal(rec.Body.Bytes(), a.ZIP) {
		res.Error = "EXPORT_BYTES_MISMATCH"
		return
	}
	destination := filepath.Join(out, "examples", res.CaseID)
	if e = os.MkdirAll(destination, 0700); e != nil {
		res.Error = e.Error()
		return
	}
	for _, f := range a.Files {
		for _, bad := range expected.Literals {
			if bytes.Contains(f.Bytes, []byte(bad)) {
				res.Error = "FORBIDDEN_LITERAL:" + bad
				return
			}
		}
		path := filepath.Join(destination, f.Path)
		os.MkdirAll(filepath.Dir(path), 0700)
		if e = os.WriteFile(path, f.Bytes, 0600); e != nil {
			res.Error = e.Error()
			return
		}
	}
	os.WriteFile(filepath.Join(destination, "public.zip"), a.ZIP, 0600)
	trace, _ := json.MarshalIndent(task.Traces, "", "  ")
	os.WriteFile(filepath.Join(out, res.CaseID+"-internal-traces.json"), append(trace, '\n'), 0600)
	res.OutputDirectory = destination
	if e = publishLatestCase(a, res.CaseID, latestOut); e != nil {
		res.Error = e.Error()
		return
	}
	res.Status = "pass"
	res.Revision = task.Revision
	res.SetHash = a.SetHash
	res.ZIPHash = a.ZIPHash
	res.ModelCalls = len(task.Traces)
	res.Repro = task.Reproduction
	return
}

// Keep each immutable run directory and atomically replace the convenience sample.
// Prior sample directories are moved aside, never deleted.
func publishLatestCase(a *domain.Artifact, caseID, out string) error {
	parent := filepath.Join(out, "examples")
	if e := os.MkdirAll(parent, 0700); e != nil {
		return e
	}
	stage, e := os.MkdirTemp(parent, ".stage-"+caseID+"-")
	if e != nil {
		return e
	}
	for _, f := range a.Files {
		path := filepath.Join(stage, f.Path)
		if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
			return e
		}
		if e = os.WriteFile(path, f.Bytes, 0600); e != nil {
			return e
		}
	}
	if e = os.WriteFile(filepath.Join(stage, "public.zip"), a.ZIP, 0600); e != nil {
		return e
	}
	destination := filepath.Join(parent, caseID)
	backup := ""
	if _, e = os.Lstat(destination); e == nil {
		history := filepath.Join(out, "previous-examples")
		if e = os.MkdirAll(history, 0700); e != nil {
			return e
		}
		backup = filepath.Join(history, caseID+"-"+domain.ID("prior"))
		if e = os.Rename(destination, backup); e != nil {
			return e
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	if e = os.Rename(stage, destination); e != nil {
		if backup != "" {
			os.Rename(backup, destination)
		}
		return e
	}
	return nil
}
