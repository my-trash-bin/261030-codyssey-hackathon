// safehandoff-eval is an independent test driver. Expected disclosure markers are never imported by the app.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/httpapi"
	"safehandoff.local/poc/internal/llm"
	"safehandoff.local/poc/internal/policy"
	"safehandoff.local/poc/internal/runner"
	"safehandoff.local/poc/internal/store"
	"safehandoff.local/poc/internal/tools"
	"safehandoff.local/poc/internal/workflow"
	"strings"
	"time"
)

type item struct {
	Name     string `json:"name"`
	Status   string `json:"status"`
	Evidence string `json:"evidence"`
}
type report struct {
	RunID     string       `json:"run_id"`
	Mode      string       `json:"mode"`
	Started   time.Time    `json:"started_at"`
	Finished  time.Time    `json:"finished_at"`
	Commit    string       `json:"code_commit"`
	Checks    []item       `json:"checks"`
	Semantic  any          `json:"human_semantic_evaluation"`
	Recipient any          `json:"recipient_evaluation"`
	Cases     []caseResult `json:"cases"`
}
type caseResult struct {
	CaseID             string             `json:"case_id"`
	Status             string             `json:"status"`
	Error              string             `json:"error_code"`
	SourceHashes       map[string]string  `json:"source_hashes"`
	Revision           int                `json:"revision"`
	SetHash            string             `json:"artifact_set_hash"`
	ZIPHash            string             `json:"zip_sha256"`
	ModelCalls         int                `json:"model_calls"`
	HumanInterventions int                `json:"human_interventions"`
	Repro              domain.ReproResult `json:"reproduction"`
}

func main() {
	mode := flag.String("mode", "fixture", "fixture/live/extensions/prepare")
	out := flag.String("out", "evaluation/results", "내부 평가 보고서 폴더")
	flag.Parse()
	r := report{RunID: domain.ID("eval"), Mode: *mode, Started: time.Now().UTC(), Checks: []item{}, Cases: []caseResult{}}
	commit, _ := exec.Command("git", "rev-parse", "HEAD").Output()
	r.Commit = strings.TrimSpace(string(commit))
	code := 0
	switch *mode {
	case "prepare":
		if e := prepare(); e != nil {
			r.Checks = append(r.Checks, item{"prepare-runners", "not_run", e.Error()})
			code = 2
		} else {
			r.Checks = append(r.Checks, item{"prepare-runners", "pass", "고정 바이너리와 scratch 이미지 digest 저장"})
		}
	case "extensions":
		if !runner.Available() {
			r.Checks = append(r.Checks, item{"docker", "not_run", "no_environment"})
			code = 2
			break
		}
		var reg runner.TargetRegistration
		var check runner.Registration
		if read("var/runners/targets.json", &reg) != nil || read("var/runners/checker.json", &check) != nil {
			r.Checks = append(r.Checks, item{"registration", "not_run", "prepare-runners 필요"})
			code = 2
			break
		}
		a, b, _ := tools.Synthetic(77, 6)
		res := runner.RunRepro(context.Background(), reg, a, b)
		status := "fail"
		if res.Status == "reproduced" {
			status = "pass"
		} else {
			code = 1
		}
		r.Checks = append(r.Checks, item{"synthetic-reproduction", status, string(domain.Canonical(res))})
		q := tools.ContextRequest{Schema: "context_check_request.v1", FindingID: "finding_specific", SetHash: "current-hash", Detector: "ip.v1", Field: "/upstreams/0/address", Provenance: "make_config_example_v1:generated_config", Product: "vendorstore-lab", RuleActive: true, Config: []byte(`{"upstreams":[{"id":"primary","address":"192.0.2.88"}],"route":{"upstream_id":"primary"}}`)}
		for _, variant := range []string{"allowed", "connection-log", "broken-route"} {
			test := q
			if variant == "connection-log" {
				test.Provenance = "original_connection_log"
			}
			if variant == "broken-route" {
				test.Config = []byte(`{"upstreams":[{"id":"primary","address":"192.0.2.17"}],"route":{"upstream_id":"missing"}}`)
			}
			raw, e := runner.Process(context.Background(), check, domain.Canonical(test))
			var got tools.ContextResult
			status = "pass"
			if e != nil || domain.Strict(raw, &got) != nil || tools.ValidateContextResult(test, got) != nil || string(domain.Canonical(got)) != string(domain.Canonical(tools.CheckContext(test))) {
				status = "fail"
				code = 1
			}
			r.Checks = append(r.Checks, item{"process-checker-" + variant, status, string(raw)})
		}
		reg.PairDigest = "wrong"
		wrong := runner.RunRepro(context.Background(), reg, a, b)
		status = "pass"
		if wrong.Status != "error" || wrong.Reason != "TARGET_DIGEST_MISMATCH" {
			status = "fail"
			code = 1
		}
		r.Checks = append(r.Checks, item{"wrong-target", status, wrong.Reason})
	case "fixture", "live":
		var p llm.Provider = llm.Fixture{}
		if *mode == "live" {
			var e error
			p, e = llm.NewLive(llm.DefaultConfig())
			if e != nil {
				r.Checks = append(r.Checks, item{"live-provider", "not_run", "PROVIDER_CONFIG_UNSUPPORTED: endpoint 또는 모델 설정 필요"})
				code = 2
				break
			}
		}
		for _, c := range []struct {
			Scenario, Purpose, Volume string
			IDs                       bool
		}{{"oss-encoding", "oss_issue", "direction", true}, {"b2b-timeout", "vendor_support", "direction", true}, {"b2b-timeout", "vendor_support", "direction", false}, {"internal-operations", "operations_advice", "ratio", true}} {
			res := runCase(p, c.Scenario, c.Purpose, c.Volume, c.IDs, *out)
			r.Cases = append(r.Cases, res)
			if res.Status != "pass" {
				code = 1
			}
		}
		r.Checks = append(r.Checks, item{"human-semantics", "not_run", "독립 사람 의미 평가 필요"}, item{"recipient-confirmation", "not_run", "공개 패키지만 받은 수신자 평가 필요"})
	default:
		fmt.Fprintln(os.Stderr, "잘못된 mode")
		os.Exit(1)
	}
	r.Finished = time.Now().UTC()
	if e := os.MkdirAll(*out, 0700); e != nil {
		panic(e)
	}
	b, _ := json.MarshalIndent(r, "", "  ")
	write(filepath.Join(*out, *mode+"-"+r.RunID+".json"), r)
	name := filepath.Join(*out, *mode+"-run.json")
	if e := os.WriteFile(name, append(b, '\n'), 0600); e != nil {
		panic(e)
	}
	fmt.Println(string(b))
	os.Exit(code)
}
func read(p string, v any) error {
	b, e := os.ReadFile(p)
	if e != nil {
		return e
	}
	return domain.Strict(b, v)
}
func write(p string, v any) error {
	b, _ := json.MarshalIndent(v, "", "  ")
	return os.WriteFile(p, append(b, '\n'), 0600)
}
func command(dir string, args ...string) ([]byte, error) {
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0")
	return cmd.CombinedOutput()
}
func prepare() error {
	if !runner.Available() {
		return errors.New("no_environment")
	}
	if e := os.MkdirAll("bin", 0755); e != nil {
		return e
	}
	for _, v := range []string{"buggy", "fixed", "probe"} {
		out, e := command("fixtures/public/targets/toyrecord", "go", "build", "-trimpath", "-o", "../../../../bin/toy-"+v, "./cmd/"+v)
		if e != nil {
			return fmt.Errorf("target build: %s", out)
		}
	}
	out, e := command(".", "go", "build", "-trimpath", "-o", "bin/safehandoff-checker", "./cmd/safehandoff-checker")
	if e != nil {
		return fmt.Errorf("checker build: %s", out)
	}
	out, e = command(".", "docker", "build", "--network=none", "-f", "deployments/runner.Dockerfile", "-t", "safehandoff-runner:local", ".")
	if e != nil {
		return fmt.Errorf("docker build: %s", out)
	}
	image, e := command(".", "docker", "image", "inspect", "--format", "{{.Id}}", "safehandoff-runner:local")
	if e != nil {
		return e
	}
	imageID := strings.TrimSpace(string(image))
	buggy, _ := os.ReadFile("bin/toy-buggy")
	fixed, _ := os.ReadFile("bin/toy-fixed")
	checker, _ := os.ReadFile("bin/safehandoff-checker")
	reg := runner.TargetRegistration{Image: imageID, BuggySHA: domain.Hash(buggy), FixedSHA: domain.Hash(fixed)}
	reg.PairDigest = domain.Hash([]byte(reg.BuggySHA + ":" + reg.FixedSHA))
	if e = os.MkdirAll("var/runners", 0700); e != nil {
		return e
	}
	if e = write("var/runners/targets.json", reg); e != nil {
		return e
	}
	return write("var/runners/checker.json", runner.Registration{Image: imageID, Executable: "/checker", BinarySHA: domain.Hash(checker)})
}
func wait(db *store.Store, id, job string) error {
	deadline := time.Now().Add(10 * time.Minute)
	for time.Now().Before(deadline) {
		t, e := db.Get(id)
		if e != nil {
			return e
		}
		for _, j := range t.Jobs {
			if j.ID == job {
				switch j.Status {
				case "succeeded":
					return nil
				case "failed", "stale", "cancelled":
					return errors.New(j.Error + ":" + j.Status)
				}
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	return errors.New("EVALUATION_TIMEOUT")
}
func runCase(p llm.Provider, scenario, purpose, volume string, ids bool, out string) (res caseResult) {
	res.CaseID = scenario + "-" + volume
	if !ids {
		res.CaseID += "-ids-excluded"
	}
	res.Status = "fail"
	res.SourceHashes = map[string]string{}
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
	defer svc.Close()
	task, e := svc.Create("가상 평가 내부 작업", domain.Scope{ProjectID: "project_demo", PurposeID: purpose, RecipientID: "recipient_vendorstore", Audience: "named_external"}, "ko")
	if e != nil {
		res.Error = e.Error()
		return
	}
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
		for _, bad := range []string{"DEMO_ONLY_SECRET", "DEMO_CUSTOMER", "71%", "2031-03-15"} {
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
	res.Status = "pass"
	res.Revision = task.Revision
	res.SetHash = a.SetHash
	res.ZIPHash = a.ZIPHash
	res.ModelCalls = len(task.Traces)
	res.Repro = task.Reproduction
	return
}
