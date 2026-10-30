package artifact

import (
	"safehandoff.local/poc/internal/domain"
	"testing"
)

func TestNewNumericClaimBlocked(t *testing.T) {
	p := domain.FactPack{Facts: []domain.Fact{{ID: "f", Statement: "요청량이 증가했습니다."}}}
	d := domain.Draft{Schema: "draft.v1", Blocks: []domain.Block{{Type: "paragraph", Text: "요청량이 999배 증가했습니다.", FactIDs: []string{"f"}}}}
	if Validate(d, p) == nil {
		t.Fatal("new number allowed")
	}
	p.Facts[0].Statement = "요청량은 999입니다."
	d.Blocks[0].Text = "요청량은 999입니다."
	if e := Validate(d, p); e != nil {
		t.Fatal("approved number rejected", e)
	}
}
func TestCSVFormulaAndPaths(t *testing.T) {
	for _, v := range []string{"=1+1", " +82", "@SUM(1)", "\tformula"} {
		if CSVCell(v) != "'"+v {
			t.Fatal(v)
		}
	}
	if CSVCell("82") != "82" {
		t.Fatal("number changed")
	}
	for _, v := range []string{"../secret", "/root", "a\\b", "a\n.txt"} {
		if SafePath(v) {
			t.Fatal(v)
		}
	}
}
func TestZIPDeterministic(t *testing.T) {
	p := domain.FactPack{Facts: []domain.Fact{{ID: "f", Statement: "관찰"}}, TemplateID: "vendor_support.v1"}
	d := domain.Draft{Schema: "draft.v1", Blocks: []domain.Block{{Type: "paragraph", Text: "관찰", FactIDs: []string{"f"}}}}
	a, e := Build(d, p)
	if e != nil {
		t.Fatal(e)
	}
	b, e := Build(d, p)
	if e != nil || a.SetHash != b.SetHash || a.ZIPHash != b.ZIPHash {
		t.Fatal("nondeterministic", e)
	}
	a.Files[0].Bytes[0] ^= 1
	if Check(a) == nil {
		t.Fatal("tamper")
	}
}
