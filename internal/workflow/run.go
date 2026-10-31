package workflow

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"os"
	"safehandoff.local/poc/internal/artifact"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/llm"
	"safehandoff.local/poc/internal/policy"
	"safehandoff.local/poc/internal/runner"
	"safehandoff.local/poc/internal/tools"
	"strings"
	"time"
)

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
	call := s.modelCaller(t, j, &traces)
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
