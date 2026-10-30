package policy

import (
	"bytes"
	"errors"
	"safehandoff.local/poc/internal/domain"
	"sort"
	"time"
	"unicode/utf8"
)

func ProjectFor(t domain.Task, c domain.Candidate, r domain.Representation, grants []domain.RawGrant) (domain.Projection, error) {
	if r.Kind != "approved_excerpt" {
		if len(grants) > 0 {
			return domain.Projection{}, errors.New("INVALID_DECISION")
		}
		return Project(c, r)
	}
	p := domain.Projection{Columns: []string{}, Rows: [][]string{}}
	if len(grants) != 1 || r.TransformID != "" || len(r.Parameters) > 0 {
		return p, errors.New("INVALID_DECISION")
	}
	g := grants[0]
	if g.Scope != t.Scope || (g.ExpiresAt != nil && !time.Now().Before(*g.ExpiresAt)) {
		return p, errors.New("SCOPE_MISMATCH")
	}
	var src *domain.Source
	for i := range t.Sources {
		if t.Sources[i].ID == g.SourceVersionID && t.Sources[i].Included {
			src = &t.Sources[i]
		}
	}
	if src == nil || src.SHA != g.SourceSHA || domain.Hash(src.Raw) != g.SourceSHA {
		return p, errors.New("BROKEN_EVIDENCE_REFERENCE")
	}
	bound := func(start, end int) bool {
		return start >= 0 && end <= len(src.Raw) && start < end && utf8.Valid(src.Raw[:start]) && utf8.Valid(src.Raw[:end])
	}
	if !bound(g.Range.Start, g.Range.End) {
		return p, errors.New("BROKEN_EVIDENCE_REFERENCE")
	}
	covered := false
	for _, ev := range t.Evidence {
		for _, id := range c.EvidenceIDs {
			if ev.ID == id && ev.SourceVersionID == src.ID && ev.Start <= g.Range.Start && ev.End >= g.Range.End {
				covered = true
			}
		}
	}
	if !covered {
		return p, errors.New("BROKEN_EVIDENCE_REFERENCE")
	}
	ranges := append([]domain.ByteRange{}, g.Hidden...)
	sort.Slice(ranges, func(i, j int) bool { return ranges[i].Start < ranges[j].Start })
	var out bytes.Buffer
	pos := g.Range.Start
	for _, h := range ranges {
		if !bound(h.Start, h.End) || h.Start < pos || h.End > g.Range.End {
			return p, errors.New("INVALID_DECISION")
		}
		out.Write(src.Raw[pos:h.Start])
		out.WriteString("[비공개]")
		pos = h.End
	}
	out.Write(src.Raw[pos:g.Range.End])
	p.Excerpt = out.Bytes()
	if domain.Hash(p.Excerpt) != g.RenderedSHA {
		return p, errors.New("INVALID_DECISION")
	}
	return p, nil
}
