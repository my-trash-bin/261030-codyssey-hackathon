package policy

import (
	"safehandoff.local/poc/internal/domain"
	"testing"
)

func TestRawGrantBindsBytesAndUTF8(t *testing.T) {
	raw := []byte("오류 secret=가상\r\n")
	src := domain.Source{ID: "s", Raw: raw, SHA: domain.Hash(raw), Included: true}
	ev := domain.EvidenceFor(src)
	task := domain.Task{Sources: []domain.Source{src}, Evidence: ev}
	c := domain.Candidate{EvidenceIDs: []string{ev[0].ID}}
	g := domain.RawGrant{SourceVersionID: "s", SourceSHA: src.SHA, Range: domain.ByteRange{Start: 0, End: len(raw)}, RenderedSHA: domain.Hash(raw), Scope: task.Scope}
	p, e := ProjectFor(task, c, domain.Representation{Kind: "approved_excerpt"}, []domain.RawGrant{g})
	if e != nil || string(p.Excerpt) != string(raw) {
		t.Fatal(p, e)
	}
	g.Range.Start = 1
	if _, e = ProjectFor(task, c, domain.Representation{Kind: "approved_excerpt"}, []domain.RawGrant{g}); e == nil {
		t.Fatal("split rune")
	}
	g.Range.Start = 0
	task.Sources[0].ID = "new"
	if _, e = ProjectFor(task, c, domain.Representation{Kind: "approved_excerpt"}, []domain.RawGrant{g}); e == nil {
		t.Fatal("new source accepted")
	}
}
