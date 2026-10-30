package store

import (
	"safehandoff.local/poc/internal/domain"
	"testing"
)

func TestRestartInterruptedAndCAS(t *testing.T) {
	dir := t.TempDir()
	s, e := Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	task := domain.Task{ID: "t", Revision: 1, Phase: "processing", Jobs: []domain.Job{{ID: "j", Status: "running"}}}
	if e = s.Save(task, 0); e != nil {
		t.Fatal(e)
	}
	task.Revision = 2
	if e = s.Save(task, 1); e != nil {
		t.Fatal(e)
	}
	if e = s.Save(task, 1); e == nil {
		t.Fatal("stale update")
	}
	s.Close()
	s, e = Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	task, e = s.Get("t")
	if e != nil || task.Jobs[0].Error != "INTERRUPTED" || task.Phase != "needs_attention" {
		t.Fatal(task, e)
	}
}

func TestDataDirectoryExclusiveOwnership(t *testing.T) {
	dir := t.TempDir()
	first, e := Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	if second, e := Open(dir); e == nil {
		second.Close()
		first.Close()
		t.Fatal("second process ownership accepted")
	}
	if e = first.Close(); e != nil {
		t.Fatal(e)
	}
	second, e := Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	second.Close()
}
