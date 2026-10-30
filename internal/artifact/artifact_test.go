package artifact

import (
	"fmt"
	"safehandoff.local/poc/internal/domain"
	"strings"
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
func TestTypedNegativeCSV(t *testing.T) {
	p := domain.FactPack{TemplateID: "operations_advice.v1", Tables: []domain.Table{{ID: "t", Columns: []string{"관찰", "건수"}, Rows: [][]string{{"first", "-82"}}, NumericColumns: []int{1}}}}
	d := domain.Draft{Schema: "draft.v1", Blocks: []domain.Block{{Type: "table_ref", TableID: "t"}}}
	a, e := Build(d, p)
	if e != nil {
		t.Fatal(e)
	}
	for _, f := range a.Files {
		if f.Path == "observations.csv" && strings.Contains(string(f.Bytes), "'-82") {
			t.Fatal("numeric value escaped as text")
		}
	}
}
func TestTenApprovedTablesRemainSeparateFiles(t *testing.T) {
	p := domain.FactPack{TemplateID: "operations_advice.v1"}
	d := domain.Draft{Schema: "draft.v1"}
	for i := 1; i <= 10; i++ {
		id := fmt.Sprintf("tb_%d", i)
		name := fmt.Sprintf("observations-%d.csv", i)
		if i == 1 {
			name = "observations.csv"
		}
		p.Tables = append(p.Tables, domain.Table{ID: id, FileName: name, Columns: []string{"관찰", "건수"}, Rows: [][]string{{"first", fmt.Sprint(i)}}, NumericColumns: []int{1}})
		d.Blocks = append(d.Blocks, domain.Block{Type: "table_ref", TableID: id})
	}
	a, e := Build(d, p)
	if e != nil {
		t.Fatal(e)
	}
	if len(a.Files) != 12 {
		t.Fatal("missing tables", len(a.Files))
	}
	if e = Check(a); e != nil {
		t.Fatal(e)
	}
}
func TestPatternExceptionOnlyAppliesToGeneratedConfig(t *testing.T) {
	config := []byte(`{"upstreams":[{"id":"primary","address":"192.0.2.17"}],"route":{"upstream_id":"primary"}}`)
	p := domain.FactPack{TemplateID: "vendor_support.v1", Facts: []domain.Fact{{ID: "f", Statement: "승인한 개별 지표 192.0, 2.17"}}, Assets: []domain.Slot{{ID: "config_example", Bytes: config}}}
	d := domain.Draft{Schema: "draft.v1", Blocks: []domain.Block{{Type: "paragraph", Text: "접속 주소 192.0.2.17", FactIDs: []string{"f"}}, {Type: "asset_ref", AssetID: "config_example"}}}
	a, e := Build(d, p)
	if e != nil {
		t.Fatal(e)
	}
	allowed, blocked := false, false
	for _, f := range a.Findings {
		allowed = allowed || f.FilePath == "client-config-example.json" && f.Resolution == "allowed_context"
		blocked = blocked || f.FilePath == "support-request.md" && f.Resolution == "blocked"
	}
	if !allowed || !blocked || Check(a) == nil {
		t.Fatal(a.Findings)
	}
	p.Facts[0].Statement = "이번 문의에 주소 192.0.2.17을 사용합니다."
	a, e = Build(d, p)
	if e != nil || Check(a) != nil {
		t.Fatal("explicit exact-value approval rejected", e)
	}
}
func TestApprovedExcerptTokenIsExactPositive(t *testing.T) {
	raw := []byte("auth_marker=DEMO_ONLY_INVALID_TOKEN\r\n")
	p := domain.FactPack{TemplateID: "vendor_support.v1", Excerpts: []domain.Slot{{ID: "x", Bytes: raw}}}
	d := domain.Draft{Schema: "draft.v1", Blocks: []domain.Block{{Type: "excerpt_ref", ExcerptID: "x"}}}
	a, e := Build(d, p)
	if e != nil || Check(a) != nil {
		t.Fatal(e)
	}
	if len(a.Findings) != 1 || a.Findings[0].Resolution != "allowed_excerpt" {
		t.Fatal(a.Findings)
	}
}
