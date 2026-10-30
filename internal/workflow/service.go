package workflow

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"safehandoff.local/poc/internal/artifact"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/llm"
	"safehandoff.local/poc/internal/policy"
	"safehandoff.local/poc/internal/runner"
	"safehandoff.local/poc/internal/store"
	"safehandoff.local/poc/internal/tools"
	"safehandoff.local/poc/prompts"
	"safehandoff.local/poc/skills"
	"strings"
	"sync"
	"time"
)

type Service struct {
	ReproductionEnabled bool
	MaxFiles            int
	MaxFileBytes        int
	MaxSourceBytes      int
	MaxExportBytes      int
	Store               *store.Store
	Provider            llm.Provider
	queue               chan string
	ctx                 context.Context
	cancel              context.CancelFunc
	wg                  sync.WaitGroup
	MaxInput            int
	MaxCalls            int
	Repairs             int
	Attempts            int
}

func New(s *store.Store, p llm.Provider) *Service {
	ctx, c := context.WithCancel(context.Background())
	v := &Service{ReproductionEnabled: true, MaxFiles: 10, MaxFileBytes: 262144, MaxSourceBytes: 1048576, MaxExportBytes: 20971520, Store: s, Provider: p, queue: make(chan string, 100), ctx: ctx, cancel: c, MaxInput: 24576, MaxCalls: 12, Repairs: 2, Attempts: 2}
	v.wg.Add(1)
	go v.worker()
	return v
}
func (s *Service) Close() { s.cancel(); s.wg.Wait() }
func (s *Service) Create(title string, scope domain.Scope, lang string) (domain.Task, error) {
	if scope.ProjectID == "" || scope.RecipientID == "" || (scope.Audience != "public" && scope.Audience != "named_external") || (scope.PurposeID != "oss_issue" && scope.PurposeID != "vendor_support" && scope.PurposeID != "operations_advice") || (lang != "ko" && lang != "en") {
		return domain.Task{}, errors.New("INVALID_REQUEST")
	}
	if scope.RecipientID == "public" && scope.Audience != "public" {
		return domain.Task{}, errors.New("SCOPE_MISMATCH")
	}
	if s.Provider.Mode() == "fixture" && lang != "ko" {
		return domain.Task{}, errors.New("UNSUPPORTED_OUTPUT_LANGUAGE")
	}
	scope.SkillSetHash = skills.Hash()
	t := domain.Task{ID: domain.ID("task"), Title: title, Scope: scope, Language: lang, Revision: 1, Phase: "needs_analysis", Mode: s.Provider.Mode(), Decisions: map[string]domain.Decision{}, Previews: map[string]domain.Preview{}, Reproduction: domain.ReproResult{Schema: "repro_result.v1", Status: "not_run", Reason: "no_environment"}}
	t.Event("task.created")
	e := s.Store.Save(t, 0)
	return t, e
}
func (s *Service) Start(id string, rev int, kind string) (domain.Job, error) {
	return s.StartWithArguments(id, rev, kind, domain.JobArguments{})
}
func (s *Service) StartWithArguments(id string, rev int, kind string, args domain.JobArguments) (domain.Job, error) {
	s.Store.Mu.Lock()
	defer s.Store.Mu.Unlock()
	t, e := s.Store.Get(id)
	if e != nil {
		return domain.Job{}, e
	}
	if t.Scope.SkillSetHash != skills.Hash() {
		return domain.Job{}, errors.New("SKILL_VERSION_CHANGED")
	}
	if t.Revision != rev {
		return domain.Job{}, errors.New("REVISION_CONFLICT")
	}
	if kind != "analyze" && kind != "compose" && kind != "review" && kind != "reproduce" && kind != "provider_check" && kind != "interpret_disclosure" {
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
	if kind == "compose" || kind == "review" || kind == "reproduce" {
		if _, e = policy.Pack(t, rules, time.Now()); e != nil {
			return domain.Job{}, e
		}
	}
	if kind == "review" {
		a := t.Artifact()
		if a == nil || (a.Status != "draft" && a.Status != "blocked") {
			return domain.Job{}, errors.New("ARTIFACT_STALE")
		}
	}
	old := t.Revision
	if kind == "analyze" && len(t.Candidates) > 0 || (kind == "compose" || kind == "reproduce") && (t.Phase == "ready_to_finalize" || t.Phase == "finalized" || (t.Artifact() != nil && (t.Artifact().Status == "ready" || t.Artifact().Status == "finalized"))) {
		t.Invalidate("needs_decisions")
	}
	j := domain.Job{Arguments: args, PreviousPhase: t.Phase, ID: domain.ID("job"), TaskID: t.ID, Revision: t.Revision, Kind: kind, Status: "queued", Started: time.Now().UTC()}
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
			r := llm.Request{Role: role, PromptVersion: role + ".v1", Messages: []llm.Message{{Role: "system", Content: prompts.Get(role) + "\n" + skills.RoleDocs(t.Scope.PurposeID, role)}, {Role: "user", Content: string(domain.Canonical(payload))}}}
			if len(domain.Canonical(r)) > s.MaxInput {
				return errors.New("CONTEXT_BUDGET_EXCEEDED")
			}
			callStarted := time.Now()
			res, err := s.Provider.Generate(s.ctx, r)
			elapsed := time.Since(callStarted).Milliseconds()
			trace := domain.Trace{InputTokens: res.InputTokens, OutputTokens: res.OutputTokens, JobID: j.ID, Role: role, Mode: s.Provider.Mode(), Request: domain.Canonical(r), Response: res.Text, ElapsedMS: elapsed}
			if live, ok := s.Provider.(*llm.Live); ok {
				trace.Model = live.Model
				trace.ProviderConfigHash = domain.Hash(domain.Canonical(map[string]any{"config": live.Config, "base_url": live.Base, "model": live.Model}))
			}
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
	var pendingDecisions []string
	var interpretation *llm.Disclosure
	var generated *domain.Artifact
	var ascii, multi []byte
	var reproduction *runner.Repro
	var candidates []domain.Candidate
	switch j.Kind {
	case "analyze":
		if len(t.Sources) == 0 {
			e = errors.New("NO_SOURCES")
			break
		}
		var a llm.Analysis
		e = call("analyst", map[string]any{"purpose_id": t.Scope.PurposeID, "sources": domain.ModelSources(t), "evidence": t.Evidence}, &a)
		if e != nil {
			break
		}
		if a.Schema != "candidate_proposals.v1" || len(a.Candidates) > 30 {
			e = errors.New("SCHEMA_INVALID")
			break
		}
		keys := map[string]bool{}
		candidateByKey := map[string]int{}
		for _, c := range a.Candidates {
			if c.LocalKey == "" || keys[c.LocalKey] || c.Statement == "" || (c.Kind != "observation" && c.Kind != "constraint" && c.Kind != "hypothesis" && c.Kind != "unknown" && c.Kind != "identifier") || (c.Uncertainty != "observed" && c.Uncertainty != "reported" && c.Uncertainty != "inferred" && c.Uncertainty != "unknown") || (c.Relevance != "required" && c.Relevance != "optional") {
				e = errors.New("SCHEMA_INVALID")
				break
			}
			keys[c.LocalKey] = true
			candidateByKey[c.LocalKey] = len(candidates)
			if e = domain.ValidateEvidence(t, c.EvidenceIDs); e != nil {
				break
			}
			candidates = append(candidates, domain.Candidate{ID: domain.ID("cand"), Kind: c.Kind, Statement: c.Statement, Uncertainty: c.Uncertainty, EvidenceIDs: c.EvidenceIDs, Required: c.Relevance == "required", Origin: "model"})
		}

		for _, conf := range a.Conflicts {
			if len(conf.Keys) < 2 {
				e = errors.New("SCHEMA_INVALID")
				break
			}
			group := domain.ID("conflict")
			for _, key := range conf.Keys {
				if !keys[key] {
					e = errors.New("REFERENCE_INVALID")
					break
				}
				index := candidateByKey[key]
				candidates[index].ConflictGroup = group
				candidates[index].ConflictReason = conf.Reason
				candidates[index].Required = true
			}
		}

		if e != nil {
			break
		}
		for _, src := range t.Sources {
			if !src.Included || src.Format != "csv" || src.Slot != "requests_v1" {
				continue
			}
			rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(src.Raw), "\ufeff"))).ReadAll()
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
				candidates = append(candidates, domain.Candidate{ID: domain.ID("cand"), Kind: "series", Statement: "요청량 공개 수준", Uncertainty: "observed", EvidenceIDs: ev, Required: true, Selector: policy.CSVSelector(src.Slot, rows[0], h), Values: vals, Origin: "app"})
			}
		}
		if t.Scope.PurposeID == "oss_issue" && len(t.Evidence) > 0 {
			candidates = append(candidates, domain.Candidate{ID: domain.ID("cand"), Kind: "synthetic", Statement: "공개 toy 계약으로 원문과 무관한 6코드포인트 합성 입력을 만들고 고정 대상의 결함·수정 버전을 실행합니다. 합성 입력과 공개 재현 코드를 첨부합니다.", Uncertainty: "reported", EvidenceIDs: []string{t.Evidence[0].ID}, Origin: "app"})
		}

		for _, src := range t.Sources {
			if !src.Included {
				continue
			}
			obs := policy.Observations(string(src.Raw))
			if len(obs) > 0 {
				evs := []string{}
				for _, ev := range t.Evidence {
					if ev.SourceVersionID == src.ID {
						evs = append(evs, ev.ID)
					}
				}
				labels := []string{}
				for _, ev := range obs {
					labels = append(labels, ev.Statement)
				}
				candidates = append(candidates, domain.Candidate{ID: domain.ID("cand"), Kind: "timeline", Statement: "관찰된 사건 순서: " + strings.Join(labels, " → ") + "。", Uncertainty: "observed", EvidenceIDs: evs, Observations: obs, Origin: "app"})
			}
		}
		if t.Scope.PurposeID == "vendor_support" && len(t.Evidence) > 0 {
			candidates = append(candidates, domain.Candidate{ID: domain.ID("cand"), Kind: "config_example", Statement: "현재 공급사 문의에 문서용 IP 대역을 사용하는 새 설정 예시를 첨부합니다. 실제 접속 로그의 주소를 공개하는 승인은 아닙니다.", Uncertainty: "reported", EvidenceIDs: []string{t.Evidence[0].ID}, Origin: "app"})
		}

		if len(candidates) > 30 {
			e = errors.New("CANDIDATE_LIMIT")
		}
	case "interpret_disclosure":
		var candidate *domain.Candidate
		for i := range t.Candidates {
			if t.Candidates[i].ID == j.Arguments.CandidateID {
				candidate = &t.Candidates[i]
			}
		}
		if candidate == nil || j.Arguments.Text == "" {
			e = errors.New("INVALID_REQUEST")
			break
		}
		var proposal llm.Disclosure
		e = call("disclosure", map[string]any{"candidate": candidate, "user_input": j.Arguments.Text, "allowed_transforms": []string{"series_direction_only.v1", "series_index_base100.v1"}}, &proposal)
		if e != nil {
			break
		}
		if proposal.Schema != "disclosure_proposal.v1" || proposal.CandidateID != candidate.ID || (proposal.Status != "supported" && proposal.Status != "ambiguous" && proposal.Status != "unsupported") {
			e = errors.New("SCHEMA_INVALID")
			break
		}
		if proposal.Status == "supported" {
			if proposal.Representation == nil || proposal.Clarify {
				e = errors.New("SCHEMA_INVALID")
				break
			}
			_, e = policy.ProjectFor(t, *candidate, *proposal.Representation, nil)
			if e != nil {
				break
			}
		} else if proposal.Representation != nil {
			e = errors.New("SCHEMA_INVALID")
			break
		}
		interpretation = &proposal
	case "compose", "review", "reproduce":
		var pack domain.FactPack
		pack, e = policy.Pack(t, rules, time.Now())
		if e != nil {
			break
		}

		for _, c := range t.Candidates {
			if c.Kind == "synthetic" {
				if d, ok := t.Decisions[c.ID]; ok && d.Disposition == "allow" && policy.Active(d, t, rules, time.Now()) {
					seed := uint64(41)
					if j.Arguments.Seed != nil {
						seed = *j.Arguments.Seed
					}
					ascii, multi, e = tools.Synthetic(seed, 6)
					if e != nil {
						break
					}
					result := runner.Repro{Schema: "repro_result.v1", Status: "not_run", Reason: "no_environment", Runs: []runner.RunObservation{}}
					var reg runner.TargetRegistration
					if b, err := os.ReadFile("var/runners/targets.json"); err == nil && domain.Strict(b, &reg) == nil && s.ReproductionEnabled {
						result = runner.RunRepro(s.ctx, reg, ascii, multi)
					}
					result.Seed = &seed
					result.Inputs = runner.DescribeInputs(ascii, multi)
					result.InputSetSHA = domain.Hash(domain.Canonical([]string{domain.Hash(ascii), domain.Hash(multi)}))
					if !s.ReproductionEnabled {
						result.Reason = "disabled_by_configuration"
					}
					reproduction = &result
					pack.ToolResults = append(pack.ToolResults, map[string]string{"status": result.Status, "reason_code": result.Reason})
				}
			}
		}
		if j.Kind == "reproduce" && reproduction == nil {
			e = errors.New("NEEDS_DISCLOSURE_DECISION")
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
			e = call("writer", domain.WriterPack(pack), &draft)
		}
		if e != nil {
			break
		}

		versionBase := 0
		for _, prior := range t.Artifacts {
			if prior.Revision == j.Revision && prior.Version > versionBase {
				versionBase = prior.Version
			}
		}
		for repair := 0; repair <= s.Repairs; repair++ {
			for i := range draft.Blocks {
				draft.Blocks[i].ID = domain.ID("block")
			}
			ar, err := artifact.Build(draft, pack)
			if err != nil {
				e = err
				break
			}
			if reproduction != nil {
				resultBytes, _ := json.MarshalIndent(reproduction, "", "  ")
				if e = artifact.AddRepro(&ar, ascii, multi, append(resultBytes, '\n')); e != nil {
					break
				}
			}
			ar.Version = versionBase + repair + 1
			draft = ar.Draft
			ar.Status = "blocked"
			generated = &ar
			if e = artifact.Check(ar); e != nil {
				break
			}
			var rev llm.Review
			e = call("reviewer", map[string]any{"sources": domain.ModelSources(t), "decisions": t.Decisions, "fact_pack": pack, "document": draft, "document_hash": ar.DocumentHash}, &rev)
			if e != nil {
				break
			}
			if e = validateReview(rev, draft, pack, t.Candidates, nil); e != nil {
				break
			}
			ar.Reviews = append(ar.Reviews, domain.Review{ID: domain.ID("review"), TargetKind: "document", TargetHash: ar.DocumentHash, Mode: s.Provider.Mode(), Result: rev.Result})
			if rev.Result == "pass" {
				var final llm.Review
				e = call("reviewer", map[string]any{"sources": domain.ModelSources(t), "decisions": t.Decisions, "fact_pack": pack, "files": reviewFiles(ar.Files), "artifact_set_hash": ar.SetHash}, &final)
				if e != nil {
					break
				}
				if e = validateReview(final, ar.Draft, pack, t.Candidates, ar.Files); e != nil {
					break
				}
				ar.Reviews = append(ar.Reviews, domain.Review{ID: domain.ID("review"), TargetKind: "files", TargetHash: ar.SetHash, Mode: s.Provider.Mode(), Result: final.Result})
				if final.Result == "needs_decision" {
					for _, issue := range final.Issues {
						pendingDecisions = append(pendingDecisions, issue.Candidates...)
					}
					e = errors.New("NEEDS_DECISIONS")
					break
				}
				if final.Result != "pass" {
					e = errors.New("REVIEW_UNRESOLVED")
					break
				}
				totalBytes := 0
				for _, f := range ar.Files {
					totalBytes += len(f.Bytes)
				}
				if totalBytes > s.MaxExportBytes || len(ar.ZIP) > s.MaxExportBytes {
					e = errors.New("EXPORT_TOO_LARGE")
					break
				}
				if e = artifact.Check(ar); e != nil {
					break
				}
				ar.Status = "ready"
				break
			}
			if rev.Result == "needs_decision" {
				for _, issue := range rev.Issues {
					pendingDecisions = append(pendingDecisions, issue.Candidates...)
				}
				e = errors.New("NEEDS_DECISIONS")
				break
			}
			if rev.Result != "needs_changes" || repair == s.Repairs {
				e = errors.New("REVIEW_UNRESOLVED")
				break
			}
			// The next request contains only the approved pack. Internal explanations never flow back.
			e = call("writer", domain.WriterPack(pack), &draft)
			if e != nil {
				break
			}
		}

	case "provider_check":
		var result struct {
			OK bool `json:"ok"`
		}
		e = call("check", map[string]string{"request": "비민감 연결 확인"}, &result)
		if e == nil && !result.OK {
			e = errors.New("SCHEMA_INVALID")
		}
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
	current.Traces = append(current.Traces, traces...)
	if status == "succeeded" {
		if reproduction != nil {
			current.Reproduction = domain.ReproResult{Revision: j.Revision, Schema: "repro_result.v1", Status: reproduction.Status, Reason: reproduction.Reason}
		}
		for _, id := range pendingDecisions {
			exists := false
			for _, old := range current.PendingDecisionIDs {
				exists = exists || old == id
			}
			if !exists {
				current.PendingDecisionIDs = append(current.PendingDecisionIDs, id)
			}
			for i := range current.Candidates {
				if current.Candidates[i].ID == id {
					current.Candidates[i].NeedsDecision = true
				}
			}
		}
		if e != nil {
			status = "failed"
			current.Phase = "needs_attention"
			if generated != nil {
				current.Artifacts = append(current.Artifacts, *generated)
				current.CurrentArtifactID = generated.ID
			}
			if e.Error() == "NEEDS_DECISIONS" {
				current.Phase = "needs_decisions"
			}
		} else if interpretation != nil {
			current.Phase = j.PreviousPhase
		} else if j.Kind == "analyze" {
			current.ScopeReduced = false
			current.Candidates = candidates
			current.PendingDecisionIDs = nil
			current.Decisions = map[string]domain.Decision{}
			current.Previews = map[string]domain.Preview{}
			current.Phase = "needs_decisions"

			for _, c := range candidates {
				r, ok := policy.AutomaticRule(rules, current.Scope, c.Selector, time.Now())
				if ok && policy.Reusable(c, r.Representation) {
					pr, err := policy.Project(c, r.Representation)
					if err == nil {
						current.Decisions[c.ID] = domain.Decision{ID: domain.ID("dec"), CandidateID: c.ID, Disposition: "allow", Representation: r.Representation, Scope: current.Scope, SourceHash: current.SourceHash(), ProjectionSHA: domain.Hash(domain.Canonical(pr)), RuleID: r.ID, RuleVersion: r.Version}
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
				if reproduction != nil {
					current.Reproduction = domain.ReproResult{Revision: j.Revision, Schema: "repro_result.v1", Status: reproduction.Status, Reason: reproduction.Reason}
				}
				if reproduction == nil {
					status, reason := "not_run", "no_environment"
					if current.Scope.PurposeID == "oss_issue" {
						status, reason = "not_requested", "user_not_requested"
					}
					current.Reproduction = domain.ReproResult{Revision: j.Revision, Schema: "repro_result.v1", Status: status, Reason: reason}
				}
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
			if interpretation != nil {
				current.Jobs[i].Result = domain.Canonical(interpretation)
			}
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
	if errors.Is(e, context.Canceled) {
		return "CANCELLED"
	}
	if errors.Is(e, context.DeadlineExceeded) {
		return "PROVIDER_TIMEOUT"
	}
	allowed := "INSUFFICIENT_OBSERVATIONS NEEDS_SCOPE_REDUCTION CANDIDATE_LIMIT INPUT_TOO_LARGE INVALID_REQUEST SCHEMA_INVALID INVALID_JSON SOURCE_CONFLICT REFERENCE_INVALID INVALID_DECISION BROKEN_EVIDENCE_REFERENCE SCOPE_MISMATCH APPROVAL_EXPIRED NO_SOURCES NO_SUPPORTED_CANDIDATES NEEDS_DECISIONS NEEDS_DISCLOSURE_DECISION NO_PUBLIC_FACTS MODEL_CALL_BUDGET_EXCEEDED CONTEXT_BUDGET_EXCEEDED OUTPUT_TRUNCATED PROVIDER_UNAVAILABLE PROVIDER_AUTH_FAILED PROVIDER_CONFIG_UNSUPPORTED PROVIDER_TIMEOUT CANCELLED INTERRUPTED REVIEW_UNRESOLVED ARTIFACT_STALE FINALIZATION_BLOCKED UNAPPROVED_DISCLOSURE UNAPPROVED_REFERENCE MISSING_REQUIRED_FACT INCORRECT_PROJECTION EXPORT_TOO_LARGE TOOL_TIMEOUT TOOL_SCHEMA_INVALID TOOL_ENVIRONMENT_UNAVAILABLE TARGET_DIGEST_MISMATCH"
	for _, code := range strings.Fields(allowed) {
		if e.Error() == code {
			return code
		}
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

func reviewFiles(files []domain.File) []domain.ModelFile {
	result := domain.ModelFiles(files)
	for i, f := range files {
		if artifact.RegisteredPublic(f.Path, f.Bytes) {
			result[i].Content = ""
			result[i].Registered = true
		}
	}
	return result
}
