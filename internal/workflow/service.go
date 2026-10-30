package workflow

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"safehandoff.local/poc/internal/artifact"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/llm"
	"safehandoff.local/poc/internal/policy"
	"safehandoff.local/poc/internal/store"
	"safehandoff.local/poc/prompts"
	"strings"
	"sync"
	"time"
)

type Service struct {
	Store    *store.Store
	Provider llm.Provider
	queue    chan string
	ctx      context.Context
	cancel   context.CancelFunc
	wg       sync.WaitGroup
	MaxInput int
	MaxCalls int
	Repairs  int
	Attempts int
}

func New(s *store.Store, p llm.Provider) *Service {
	ctx, c := context.WithCancel(context.Background())
	v := &Service{Store: s, Provider: p, queue: make(chan string, 100), ctx: ctx, cancel: c, MaxInput: 24576, MaxCalls: 12, Repairs: 2, Attempts: 2}
	v.wg.Add(1)
	go v.worker()
	return v
}
func (s *Service) Close() { s.cancel(); s.wg.Wait() }
func (s *Service) Create(title string, scope domain.Scope, lang string) (domain.Task, error) {
	if scope.ProjectID == "" || scope.RecipientID == "" || (scope.Audience != "public" && scope.Audience != "named_external") || (scope.PurposeID != "oss_issue" && scope.PurposeID != "vendor_support" && scope.PurposeID != "operations_advice") || (lang != "ko" && lang != "en") {
		return domain.Task{}, errors.New("INVALID_REQUEST")
	}
	scope.SkillSetHash = domain.Hash([]byte("builtin-skills.v1"))
	t := domain.Task{ID: domain.ID("task"), Title: title, Scope: scope, Language: lang, Revision: 1, Phase: "needs_analysis", Mode: s.Provider.Mode(), Decisions: map[string]domain.Decision{}, Previews: map[string]domain.Preview{}, Reproduction: domain.ReproResult{Schema: "repro_result.v1", Status: "not_run", Reason: "no_environment"}}
	t.Event("task.created")
	e := s.Store.Save(t, 0)
	return t, e
}
func (s *Service) Start(id string, rev int, kind string) (domain.Job, error) {
	s.Store.Mu.Lock()
	defer s.Store.Mu.Unlock()
	t, e := s.Store.Get(id)
	if e != nil {
		return domain.Job{}, e
	}
	if t.Revision != rev {
		return domain.Job{}, errors.New("REVISION_CONFLICT")
	}
	if kind != "analyze" && kind != "compose" && kind != "review" && kind != "reproduce" {
		return domain.Job{}, errors.New("INVALID_REQUEST")
	}
	for _, j := range t.Jobs {
		if j.ID == t.CurrentJobID && (j.Status == "running" || j.Status == "queued") && j.Revision == rev {
			return domain.Job{}, errors.New("JOB_ALREADY_RUNNING")
		}
	}
	if len(s.queue) == cap(s.queue) {
		return domain.Job{}, errors.New("QUEUE_FULL")
	}
	rules, e := s.Store.Rules()
	if e != nil {
		return domain.Job{}, e
	}
	if kind == "compose" || kind == "review" {
		if _, e = policy.Pack(t, rules, time.Now()); e != nil {
			return domain.Job{}, e
		}
	}
	old := t.Revision
	if kind == "analyze" && len(t.Candidates) > 0 || kind == "compose" && (t.Phase == "ready_to_finalize" || t.Phase == "finalized") {
		t.Invalidate("needs_decisions")
	}
	j := domain.Job{ID: domain.ID("job"), TaskID: t.ID, Revision: t.Revision, Kind: kind, Status: "queued", Started: time.Now().UTC()}
	t.CurrentJobID = j.ID
	t.Jobs = append(t.Jobs, j)
	t.Phase = "processing"
	t.Event("job.started")
	if e = s.Store.Save(t, old); e != nil {
		return j, e
	}
	s.queue <- j.ID
	return j, nil
}
func (s *Service) findJob(id string) (domain.Task, domain.Job, error) {
	ts, e := s.Store.List()
	if e != nil {
		return domain.Task{}, domain.Job{}, e
	}
	for _, t := range ts {
		for _, j := range t.Jobs {
			if j.ID == id {
				return t, j, nil
			}
		}
	}
	return domain.Task{}, domain.Job{}, errors.New("NOT_FOUND")
}
func (s *Service) worker() {
	defer s.wg.Done()
	for {
		select {
		case <-s.ctx.Done():
			return
		case id := <-s.queue:
			s.run(id)
		}
	}
}
func (s *Service) run(id string) {
	s.Store.Mu.Lock()
	t, j, e := s.findJob(id)
	if e != nil {
		s.Store.Mu.Unlock()
		return
	}
	if j.Cancel || j.Revision != t.Revision || t.CurrentJobID != j.ID {
		for i := range t.Jobs {
			if t.Jobs[i].ID == id {
				t.Jobs[i].Status = "stale"
			}
		}
		s.Store.Save(t, t.Revision)
		s.Store.Mu.Unlock()
		return
	}
	for i := range t.Jobs {
		if t.Jobs[i].ID == id {
			t.Jobs[i].Status = "running"
		}
	}
	if e = s.Store.Save(t, t.Revision); e != nil {
		s.Store.Mu.Unlock()
		return
	}
	rules, e := s.Store.Rules()
	s.Store.Mu.Unlock()
	if e != nil {
		return
	}
	snapshot := t
	traces := []domain.Trace{}
	calls := 0
	call := func(role string, payload any, out any) error {
		var last error
		for attempt := 0; attempt < s.Attempts; attempt++ {
			if calls >= s.MaxCalls {
				return errors.New("MODEL_CALL_BUDGET_EXCEEDED")
			}
			calls++
			r := llm.Request{Role: role, PromptVersion: role + ".v1", Messages: []llm.Message{{Role: "system", Content: prompts.Get(role)}, {Role: "user", Content: string(domain.Canonical(payload))}}}
			if len(domain.Canonical(r)) > s.MaxInput {
				return errors.New("CONTEXT_BUDGET_EXCEEDED")
			}
			res, err := s.Provider.Generate(s.ctx, r)
			trace := domain.Trace{JobID: j.ID, Role: role, Mode: s.Provider.Mode(), Request: domain.Canonical(r), Response: res.Text, ElapsedMS: res.ElapsedMS}
			if err == nil {
				err = llm.Parse(res.Text, out)
			}
			if err != nil {
				trace.Error = safeCode(err)
			}
			traces = append(traces, trace)
			if err == nil {
				return nil
			}
			last = err
			if strings.Contains(err.Error(), "AUTH") || strings.Contains(err.Error(), "CONFIG") || strings.Contains(err.Error(), "CONTEXT") || strings.Contains(err.Error(), "CANCELLED") {
				break
			}
		}
		return last
	}
	var generated *domain.Artifact
	var candidates []domain.Candidate
	switch j.Kind {
	case "analyze":
		if len(t.Sources) == 0 {
			e = errors.New("NO_SOURCES")
			break
		}
		var a llm.Analysis
		e = call("analyst", map[string]any{"task": domain.Task{Scope: t.Scope, Sources: t.Sources, Evidence: t.Evidence}}, &a)
		if e != nil {
			break
		}
		if a.Schema != "candidate_proposals.v1" || len(a.Candidates) > 30 {
			e = errors.New("SCHEMA_INVALID")
			break
		}
		keys := map[string]bool{}
		for _, c := range a.Candidates {
			if c.LocalKey == "" || keys[c.LocalKey] || c.Statement == "" || (c.Kind != "observation" && c.Kind != "constraint" && c.Kind != "unknown" && c.Kind != "identifier") || (c.Uncertainty != "observed" && c.Uncertainty != "reported" && c.Uncertainty != "inferred" && c.Uncertainty != "unknown") || (c.Relevance != "required" && c.Relevance != "optional") {
				e = errors.New("SCHEMA_INVALID")
				break
			}
			keys[c.LocalKey] = true
			if e = domain.ValidateEvidence(t, c.EvidenceIDs); e != nil {
				break
			}
			candidates = append(candidates, domain.Candidate{ID: domain.ID("cand"), Kind: c.Kind, Statement: c.Statement, Uncertainty: c.Uncertainty, EvidenceIDs: c.EvidenceIDs, Required: c.Relevance == "required", Origin: "model"})
		}
		for _, conf := range a.Conflicts {
			for _, key := range conf.Keys {
				if !keys[key] {
					e = errors.New("REFERENCE_INVALID")
				}
			}
		}
		if len(a.Conflicts) > 0 {
			e = errors.New("SOURCE_CONFLICT")
		}
		if e != nil {
			break
		}
		for _, src := range t.Sources {
			if !src.Included || src.Format != "csv" {
				continue
			}
			rows, err := csv.NewReader(strings.NewReader(string(src.Raw))).ReadAll()
			if err != nil || len(rows) < 2 {
				continue
			}
			for col, h := range rows[0] {
				if h != "count" && h != "requests_per_minute" {
					continue
				}
				vals := []string{}
				for _, row := range rows[1:] {
					vals = append(vals, row[col])
				}
				ev := []string{}
				for _, v := range t.Evidence {
					if v.SourceVersionID == src.ID {
						ev = append(ev, v.ID)
					}
				}
				candidates = append(candidates, domain.Candidate{ID: domain.ID("cand"), Kind: "series", Statement: "요청량 공개 수준", Uncertainty: "observed", EvidenceIDs: ev, Required: true, Selector: "csv:" + src.Slot + ":" + strings.Join(rows[0], ",") + ":" + h, Values: vals, Origin: "app"})
			}
		}
	case "compose", "review":
		var pack domain.FactPack
		pack, e = policy.Pack(t, rules, time.Now())
		if e != nil {
			break
		}
		var draft domain.Draft
		if j.Kind == "review" {
			if t.Artifact() == nil {
				e = errors.New("ARTIFACT_STALE")
				break
			}
			draft = t.Artifact().Draft
		} else {
			e = call("writer", pack, &draft)
		}
		if e != nil {
			break
		}
		for repair := 0; repair <= s.Repairs; repair++ {
			if e = artifact.Validate(draft, pack); e != nil {
				break
			}
			var rev llm.Review
			e = call("reviewer", map[string]any{"sources": t.Sources, "decisions": t.Decisions, "fact_pack": pack, "document": draft}, &rev)
			if e != nil {
				break
			}
			if e = validateReview(rev, draft, pack, t.Candidates, nil); e != nil {
				break
			}
			if rev.Result == "pass" {
				var ar domain.Artifact
				ar, e = artifact.Build(draft, pack)
				if e != nil {
					break
				}
				ar.Reviews = append(ar.Reviews, domain.Review{ID: domain.ID("review"), TargetKind: "document", TargetHash: ar.DocumentHash, Mode: s.Provider.Mode(), Result: "pass"})
				var final llm.Review
				e = call("reviewer", map[string]any{"sources": t.Sources, "decisions": t.Decisions, "fact_pack": pack, "files": ar.Files, "artifact_set_hash": ar.SetHash}, &final)
				if e != nil {
					break
				}
				if e = validateReview(final, ar.Draft, pack, t.Candidates, ar.Files); e != nil {
					break
				}
				if final.Result != "pass" {
					e = errors.New("REVIEW_UNRESOLVED")
					break
				}
				if e = artifact.Check(ar); e != nil {
					break
				}
				ar.Reviews = append(ar.Reviews, domain.Review{ID: domain.ID("review"), TargetKind: "files", TargetHash: ar.SetHash, Mode: s.Provider.Mode(), Result: "pass"})
				ar.Status = "ready"
				generated = &ar
				break
			}
			if rev.Result == "needs_decision" {
				e = errors.New("NEEDS_DECISIONS")
				break
			}
			if rev.Result != "needs_changes" || repair == s.Repairs {
				e = errors.New("REVIEW_UNRESOLVED")
				break
			} // Repair request is always a new message array containing only the approved pack.
			e = call("writer", pack, &draft)
			if e != nil {
				break
			}
		}
	case "reproduce":
		t.Reproduction = domain.ReproResult{Schema: "repro_result.v1", Status: "not_run", Reason: "no_environment"}
	}

	s.Store.Mu.Lock()
	defer s.Store.Mu.Unlock()
	current, err := s.Store.Get(t.ID)
	if err != nil {
		return
	}
	status := "succeeded"
	if current.Revision != j.Revision || current.CurrentJobID != j.ID {
		status = "stale"
	}
	for _, job := range current.Jobs {
		if job.ID == j.ID && job.Cancel {
			status = "cancelled"
		}
	}
	if status == "succeeded" {
		current.Traces = append(current.Traces, traces...)
		if e != nil {
			status = "failed"
			current.Phase = "needs_attention"
			if e.Error() == "NEEDS_DECISIONS" {
				current.Phase = "needs_decisions"
			}
		} else if j.Kind == "analyze" {
			current.Candidates = candidates
			current.Decisions = map[string]domain.Decision{}
			current.Previews = map[string]domain.Preview{}
			current.Phase = "needs_decisions"
			for _, c := range candidates {
				for _, r := range rules {
					if r.Scope == current.Scope && r.Selector == c.Selector && !r.Revoked && (r.ExpiresAt == nil || time.Now().Before(*r.ExpiresAt)) && policy.Reusable(c, r.Representation) {
						pr, err := policy.Project(c, r.Representation)
						if err == nil {
							current.Decisions[c.ID] = domain.Decision{ID: domain.ID("dec"), CandidateID: c.ID, Disposition: "allow", Representation: r.Representation, Scope: current.Scope, SourceHash: current.SourceHash(), ProjectionSHA: domain.Hash(domain.Canonical(pr)), RuleID: r.ID, RuleVersion: r.Version}
						}
					}
				}
			}
		} else if generated != nil {
			freshRules, err := s.Store.Rules()
			if err != nil {
				status = "failed"
				e = err
			} else if _, err = policy.Pack(current, freshRules, time.Now()); err != nil {
				status = "stale"
				current.Phase = "needs_decisions"
			} else {
				current.Artifacts = append(current.Artifacts, *generated)
				current.CurrentArtifactID = generated.ID
				current.Phase = "ready_to_finalize"
			}
		} else {
			current.Reproduction = t.Reproduction
			current.Phase = snapshot.Phase
			if current.Phase == "processing" {
				current.Phase = "needs_decisions"
			}
		}
	}
	for i := range current.Jobs {
		if current.Jobs[i].ID == j.ID {
			current.Jobs[i].Status = status
			now := time.Now().UTC()
			current.Jobs[i].Finished = &now
			if e != nil {
				current.Jobs[i].Error = safeCode(e)
			}
		}
	}
	current.Event("review.completed")
	s.Store.Save(current, current.Revision)
}

func safeCode(e error) string {
	v := e.Error()
	if len(v) < 80 && !strings.ContainsAny(v, " :\n\r\t") {
		return v
	}
	return "SCHEMA_INVALID"
}
func validateReview(r llm.Review, d domain.Draft, p domain.FactPack, c []domain.Candidate, files []domain.File) error {
	if r.Schema != "review.v1" {
		return errors.New("SCHEMA_INVALID")
	}
	if r.Result == "pass" {
		if len(r.Issues) > 0 {
			return errors.New("SCHEMA_INVALID")
		}
		return nil
	}
	if r.Result != "needs_changes" && r.Result != "needs_decision" && r.Result != "error" {
		return errors.New("SCHEMA_INVALID")
	}
	if len(r.Issues) == 0 {
		return errors.New("REVIEW_UNRESOLVED")
	}
	reasons := map[string]bool{}
	for _, s := range strings.Split("UNAPPROVED_DISCLOSURE UNSUPPORTED_CAUSAL_CLAIM MISSING_REQUIRED_FACT SOURCE_CONFLICT UNCERTAINTY_REMOVED INCORRECT_PROJECTION UNAPPROVED_REFERENCE NEEDS_DISCLOSURE_DECISION", " ") {
		reasons[s] = true
	}
	for _, i := range r.Issues {
		if !reasons[i.Reason] {
			return errors.New("SCHEMA_INVALID")
		}
		found := i.Target.Kind == "document" && i.Target.BlockID == "" && i.Target.FileID == ""
		if i.Target.Kind == "block" {
			for _, b := range d.Blocks {
				found = found || b.ID != "" && b.ID == i.Target.BlockID
			}
		}
		if i.Target.Kind == "file" {
			for _, f := range files {
				found = found || f.ID == i.Target.FileID
			}
		}
		if !found {
			return errors.New("REFERENCE_INVALID")
		}
		for _, id := range i.Facts {
			ok := false
			for _, f := range p.Facts {
				ok = ok || id == f.ID
			}
			if !ok {
				return errors.New("REFERENCE_INVALID")
			}
		}
		for _, id := range i.Candidates {
			ok := false
			for _, v := range c {
				ok = ok || id == v.ID
			}
			if !ok {
				return errors.New("REFERENCE_INVALID")
			}
		}
		if i.Action == nil {
			return errors.New("REVIEW_UNRESOLVED")
		}
		switch *i.Action {
		case "delete":
			if i.Target.Kind != "block" || len(i.Facts)+len(i.Candidates) > 0 {
				return errors.New("REFERENCE_INVALID")
			}
		case "rewrite_from_facts":
			if len(i.Facts) == 0 || len(i.Candidates) > 0 || i.Target.Kind == "file" {
				return errors.New("REFERENCE_INVALID")
			}
		case "request_decision":
			if len(i.Candidates) == 0 || len(i.Facts) > 0 || r.Result != "needs_decision" {
				return errors.New("REFERENCE_INVALID")
			}
		default:
			return fmt.Errorf("SCHEMA_INVALID")
		}
	}
	return nil
}
