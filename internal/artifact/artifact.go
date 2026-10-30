package artifact

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"safehandoff.local/poc/internal/domain"
	"sort"
	"strings"
	"time"
)

func Validate(d domain.Draft, p domain.FactPack) error {
	if d.Schema != "draft.v1" || len(d.Blocks) == 0 || len(d.Blocks) > 60 {
		return errors.New("SCHEMA_INVALID")
	}
	facts := map[string]bool{}
	tables := map[string]bool{}
	seen := map[string]bool{}
	for _, f := range p.Facts {
		facts[f.ID] = true
	}
	for _, tb := range p.Tables {
		tables[tb.ID] = true
	}
	for _, b := range d.Blocks {
		switch b.Type {
		case "heading", "paragraph":
			if b.Type == "heading" && (b.Level < 1 || b.Level > 3) {
				return errors.New("SCHEMA_INVALID")
			}
			if b.Text == "" || len(b.FactIDs) == 0 || len(b.Text) > 8192 || strings.ContainsAny(b.Text, "<>") || strings.Contains(b.Text, "://") {
				return errors.New("UNAPPROVED_REFERENCE")
			}
			for _, id := range b.FactIDs {
				if !facts[id] {
					return errors.New("REFERENCE_INVALID")
				}
				seen[id] = true
			}
		case "list":
			if len(b.Items) == 0 {
				return errors.New("SCHEMA_INVALID")
			}
			for _, it := range b.Items {
				if it.Text == "" || len(it.FactIDs) == 0 {
					return errors.New("REFERENCE_INVALID")
				}
				for _, id := range it.FactIDs {
					if !facts[id] {
						return errors.New("REFERENCE_INVALID")
					}
					seen[id] = true
				}
			}
		case "table_ref":
			if !tables[b.TableID] {
				return errors.New("REFERENCE_INVALID")
			}
		default:
			return errors.New("UNAPPROVED_REFERENCE")
		}
		if b.Type != "table_ref" && b.TableID != "" || b.Type != "list" && len(b.Items) > 0 || b.ExcerptID != "" || b.AssetID != "" {
			return errors.New("UNAPPROVED_REFERENCE")
		}
	}
	for _, id := range p.Required {
		if !seen[id] {
			return errors.New("MISSING_REQUIRED_FACT")
		}
	}
	return nil
}
func Escape(s string) string {
	r := strings.NewReplacer("\\", "\\\\", "`", "\\`", "*", "\\*", "_", "\\_", "[", "\\[", "]", "\\]", "<", "&lt;", ">", "&gt;", "#", "\\#", "!", "\\!")
	return r.Replace(s)
}
func CSVCell(s string) string {
	trim := strings.TrimLeft(s, " ")
	if strings.HasPrefix(s, "\t") || strings.HasPrefix(s, "\r") || strings.HasPrefix(s, "\n") || (len(trim) > 0 && strings.ContainsRune("=+-@", rune(trim[0]))) {
		return "'" + s
	}
	return s
}
func Build(d domain.Draft, p domain.FactPack) (domain.Artifact, error) {
	a := domain.Artifact{ID: domain.ID("art"), Revision: p.Revision, Version: 1, Pack: p, Draft: d, Status: "checking"}
	if e := Validate(d, p); e != nil {
		return a, e
	}
	for i := range a.Draft.Blocks {
		a.Draft.Blocks[i].ID = domain.ID("block")
	}
	a.DocumentHash = domain.Hash(domain.Canonical(a.Draft))
	var md strings.Builder
	for _, b := range a.Draft.Blocks {
		switch b.Type {
		case "heading":
			fmt.Fprintf(&md, "%s %s\n\n", strings.Repeat("#", b.Level), Escape(b.Text))
		case "paragraph":
			fmt.Fprintf(&md, "%s\n\n", Escape(b.Text))
		case "list":
			for _, it := range b.Items {
				fmt.Fprintf(&md, "- %s\n", Escape(it.Text))
			}
			md.WriteString("\n")
		case "table_ref":
			for _, tb := range p.Tables {
				if tb.ID == b.TableID {
					md.WriteString("표: observations.csv\n\n")
				}
			}
		}
	}
	name := "support-request.md"
	switch p.TemplateID {
	case "oss_issue.v1":
		name = "issue.md"
	case "operations_advice.v1":
		name = "operations-brief.md"
	}
	a.Files = append(a.Files, file(name, "text/markdown; charset=utf-8", []byte(md.String())))
	if len(p.Tables) > 0 {
		var buf bytes.Buffer
		w := csv.NewWriter(&buf)
		for _, tb := range p.Tables {
			w.Write(tb.Columns)
			for _, row := range tb.Rows {
				cells := make([]string, len(row))
				for i, v := range row {
					cells[i] = CSVCell(v)
				}
				w.Write(cells)
			}
		}
		w.Flush()
		if e := w.Error(); e != nil {
			return a, e
		}
		a.Files = append(a.Files, file("observations.csv", "text/csv; charset=utf-8", buf.Bytes()))
	}
	manifest := []map[string]any{}
	for _, f := range a.Files {
		manifest = append(manifest, map[string]any{"path": f.Path, "media_type": f.MediaType, "size": f.Size, "sha256": f.SHA})
	}
	mb, _ := json.MarshalIndent(manifest, "", "  ")
	a.Files = append(a.Files, file("manifest.json", "application/json", append(mb, '\n')))
	sort.Slice(a.Files, func(i, j int) bool { return a.Files[i].Path < a.Files[j].Path })
	a.SetHash = SetHash(a.Files)
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	for _, f := range a.Files {
		h := &zip.FileHeader{Name: f.Path, Method: zip.Deflate}
		h.SetModTime(time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC))
		h.SetMode(0644)
		w, e := z.CreateHeader(h)
		if e != nil {
			return a, e
		}
		if _, e = w.Write(f.Bytes); e != nil {
			return a, e
		}
	}
	if e := z.Close(); e != nil {
		return a, e
	}
	a.ZIP = buf.Bytes()
	a.ZIPHash = domain.Hash(a.ZIP)
	return a, nil
}
func file(path, media string, b []byte) domain.File {
	return domain.File{ID: domain.ID("file"), Path: path, MediaType: media, Bytes: b, Size: len(b), SHA: domain.Hash(b)}
}
func SetHash(files []domain.File) string {
	parts := []map[string]any{}
	for _, f := range files {
		parts = append(parts, map[string]any{"path": f.Path, "size": f.Size, "sha256": f.SHA})
	}
	sort.Slice(parts, func(i, j int) bool { return parts[i]["path"].(string) < parts[j]["path"].(string) })
	return domain.Hash(domain.Canonical(parts))
}
func Check(a domain.Artifact) error {
	allowed := map[string]bool{"support-request.md": true, "issue.md": true, "operations-brief.md": true, "observations.csv": true, "manifest.json": true}
	seen := map[string]bool{}
	for _, f := range a.Files {
		if !allowed[f.Path] || seen[f.Path] || f.Size != len(f.Bytes) || domain.Hash(f.Bytes) != f.SHA {
			return errors.New("FINALIZATION_BLOCKED")
		}
		seen[f.Path] = true
	}
	if SetHash(a.Files) != a.SetHash || domain.Hash(a.ZIP) != a.ZIPHash || domain.Hash(domain.Canonical(a.Draft)) != a.DocumentHash {
		return errors.New("FINALIZATION_BLOCKED")
	}
	zr, e := zip.NewReader(bytes.NewReader(a.ZIP), int64(len(a.ZIP)))
	if e != nil || len(zr.File) != len(a.Files) {
		return errors.New("FINALIZATION_BLOCKED")
	}
	return Validate(a.Draft, a.Pack)
}
