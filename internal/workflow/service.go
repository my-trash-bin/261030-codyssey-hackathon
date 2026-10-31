package workflow

import (
	"context"
	"errors"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/llm"
	"safehandoff.local/poc/internal/policy"
	"safehandoff.local/poc/internal/store"
	"safehandoff.local/poc/skills"
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
