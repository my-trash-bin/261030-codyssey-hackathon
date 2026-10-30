package workflow

import (
	"context"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/llm"
	"safehandoff.local/poc/internal/store"
	"testing"
	"time"
)

type delayed struct {
	started chan struct{}
	release chan struct{}
}

func (d delayed) Mode() string { return "fixture" }
func (d delayed) Generate(c context.Context, r llm.Request) (llm.Response, error) {
	close(d.started)
	select {
	case <-d.release:
	case <-c.Done():
		return llm.Response{}, c.Err()
	}
	return llm.Fixture{}.Generate(c, r)
}
func TestLateResultCannotReplaceCurrentRevision(t *testing.T) {
	db, e := store.Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	p := delayed{make(chan struct{}), make(chan struct{})}
	s := New(db, p)
	defer s.Close()
	task, e := s.Create("x", domain.Scope{ProjectID: "p", PurposeID: "vendor_support", RecipientID: "r", Audience: "public"}, "ko")
	if e != nil {
		t.Fatal(e)
	}
	src := domain.Source{ID: "s", SourceID: "s", Raw: []byte("event=response_timeout"), Included: true, Format: "txt"}
	src.SHA = domain.Hash(src.Raw)
	task.Sources = []domain.Source{src}
	task.Evidence = domain.EvidenceFor(src)
	db.Save(task, task.Revision)
	j, e := s.Start(task.ID, task.Revision, "analyze")
	if e != nil {
		t.Fatal(e)
	}
	<-p.started
	db.Mu.Lock()
	task, e = db.Get(task.ID)
	if e != nil {
		t.Fatal(e)
	}
	old := task.Revision
	task.Invalidate("needs_analysis")
	if e = db.Save(task, old); e != nil {
		t.Fatal(e)
	}
	db.Mu.Unlock()
	close(p.release)
	for i := 0; i < 100; i++ {
		task, _ = db.Get(task.ID)
		for _, job := range task.Jobs {
			if job.ID == j.ID && job.Status == "stale" {
				if len(task.Candidates) > 0 || task.Phase != "needs_analysis" {
					t.Fatal("stale applied")
				}
				return
			}
		}
		time.Sleep(time.Millisecond * 5)
	}
	t.Fatal("did not finish")
}
