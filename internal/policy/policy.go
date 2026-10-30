package policy

import (
	"errors"
	"fmt"
	"math/big"
	"safehandoff.local/poc/internal/domain"
	"strings"
	"time"
)

func Project(c domain.Candidate, r domain.Representation) (domain.Projection, error) {
	if c.Kind == "timeline" {
		return Timeline(c, r)
	}
	if c.Kind == "config_example" {
		return ConfigProjection(c, r)
	}
	p := domain.Projection{Columns: []string{}, Rows: [][]string{}}
	if len(r.Parameters) > 5 {
		return p, errors.New("INVALID_DECISION")
	}
	switch r.Kind {
	case "fact_summary":
		if r.TransformID != "" || len(r.Parameters) > 0 {
			return p, errors.New("INVALID_DECISION")
		}
		if c.Kind == "series" {
			increasing, decreasing := true, true
			for i := 1; i < len(c.Values); i++ {
				a, b := new(big.Rat), new(big.Rat)
				if _, ok := a.SetString(c.Values[i-1]); !ok {
					return p, errors.New("INCOMPLETE")
				}
				if _, ok := b.SetString(c.Values[i]); !ok {
					return p, errors.New("INCOMPLETE")
				}
				increasing = increasing && b.Cmp(a) > 0
				decreasing = decreasing && b.Cmp(a) < 0
			}
			p.Statement = "관찰된 구간에서 요청량의 변화가 있었습니다."
			if increasing && len(c.Values) > 1 {
				p.Statement = "관찰된 구간에서 요청량이 증가했습니다."
			}
			if decreasing && len(c.Values) > 1 {
				p.Statement = "관찰된 구간에서 요청량이 감소했습니다."
			}
		} else {
			p.Statement = c.Statement
		}
	case "exact_value":
		if r.TransformID != "" || len(r.Parameters) > 0 {
			return p, errors.New("INVALID_DECISION")
		}
		if c.Kind == "series" {
			p.Columns = []string{"관찰", "요청량"}
			for i, v := range c.Values {
				if _, ok := new(big.Rat).SetString(v); !ok || !domain.IsDecimal(v) {
					return p, errors.New("INCOMPLETE")
				}
				p.Rows = append(p.Rows, []string{fmt.Sprint(i + 1), v})
			}
		} else {
			p.Statement = c.Statement
		}

	case "selected_fields":
		if c.Kind != "series" || r.TransformID != "" || len(c.Values) == 0 {
			return p, errors.New("INVALID_DECISION")
		}
		allowed := map[string]bool{"include_observation": true, "include_count": true, "include_unit": true, "start_row": true, "end_row": true}
		for key := range r.Parameters {
			if !allowed[key] {
				return p, errors.New("INVALID_DECISION")
			}
		}
		observation, count, unit := r.Parameters["include_observation"], r.Parameters["include_count"], r.Parameters["include_unit"]
		if observation < 0 || observation > 1 || count < 0 || count > 1 || unit < 0 || unit > 1 || observation+count == 0 || unit == 1 && count == 0 {
			return p, errors.New("INVALID_DECISION")
		}
		start := r.Parameters["start_row"]
		end, exists := r.Parameters["end_row"]
		if !exists {
			end = len(c.Values)
		}
		if start < 0 || end > len(c.Values) || start >= end {
			return p, errors.New("INVALID_DECISION")
		}
		if observation == 1 {
			p.Columns = append(p.Columns, "관찰")
		}
		if count == 1 {
			header := "요청량"
			if unit == 1 && strings.HasSuffix(c.Selector, ":requests_per_minute") {
				header = "분당 요청량"
			}
			p.Columns = append(p.Columns, header)
		}
		for i := start; i < end; i++ {
			row := []string{}
			if observation == 1 {
				row = append(row, fmt.Sprint(i+1))
			}
			if count == 1 {
				if !domain.IsDecimal(c.Values[i]) {
					return p, errors.New("INCOMPLETE")
				}
				row = append(row, c.Values[i])
			}
			p.Rows = append(p.Rows, row)
		}
	case "derived_table":
		if c.Kind != "series" || len(c.Values) == 0 {
			return p, errors.New("INVALID_DECISION")
		}
		nums := make([]*big.Rat, len(c.Values))
		for i, v := range c.Values {
			n, ok := new(big.Rat).SetString(v)
			if !ok || !domain.IsDecimal(v) {
				return p, errors.New("INCOMPLETE")
			}
			nums[i] = n
		}
		switch r.TransformID {
		case "series_direction_only.v1":
			if len(r.Parameters) > 0 {
				return p, errors.New("INVALID_DECISION")
			}
			p.Columns = []string{"관찰", "이전 관찰 대비 변화"}
			for i, n := range nums {
				v := "기준"
				if i > 0 {
					switch n.Cmp(nums[i-1]) {
					case -1:
						v = "감소"
					case 0:
						v = "동일"
					case 1:
						v = "증가"
					}
				}
				p.Rows = append(p.Rows, []string{fmt.Sprintf("%d번째", i+1), v})
			}
		case "series_index_base100.v1":
			dp, ok := r.Parameters["decimal_places"]
			if !ok || dp < 0 || dp > 4 || len(r.Parameters) != 1 || nums[0].Sign() == 0 {
				return p, errors.New("UNDEFINED_PROJECTION")
			}
			p.Columns = []string{"관찰", "첫 관찰=100 지수"}
			for i, n := range nums {
				q := new(big.Rat).Mul(new(big.Rat).Quo(n, nums[0]), big.NewRat(100, 1))
				p.Rows = append(p.Rows, []string{fmt.Sprint(i + 1), round(q, dp)})
			}
		default:
			return p, errors.New("INVALID_DECISION")
		}
	default:
		return p, errors.New("INVALID_DECISION")
	}
	return p, nil
}
func round(r *big.Rat, dp int) string {
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(dp)), nil)
	n := new(big.Int).Mul(r.Num(), scale)
	neg := n.Sign() < 0
	n.Abs(n)
	q, rem := new(big.Int), new(big.Int)
	q.QuoRem(n, r.Denom(), rem)
	if new(big.Int).Lsh(rem, 1).Cmp(r.Denom()) >= 0 {
		q.Add(q, big.NewInt(1))
	}
	s := q.String()
	for len(s) <= dp {
		s = "0" + s
	}
	if dp > 0 {
		s = s[:len(s)-dp] + "." + s[len(s)-dp:]
	}
	if neg {
		s = "-" + s
	}
	return s
}
func Active(d domain.Decision, t domain.Task, rules []domain.Rule, now time.Time) bool {
	if d.Revoked || d.Scope != t.Scope || d.SourceHash != t.SourceHash() || (d.ExpiresAt != nil && !now.Before(*d.ExpiresAt)) {
		return false
	}
	if d.RuleID != "" {
		for _, r := range rules {
			if r.ID == d.RuleID && r.Version == d.RuleVersion {
				return !r.Revoked && r.Scope == t.Scope && (r.ExpiresAt == nil || now.Before(*r.ExpiresAt))
			}
		}
		return false
	}
	return true
}
func Pack(t domain.Task, rules []domain.Rule, now time.Time) (domain.FactPack, error) {
	p := domain.FactPack{Schema: "fact_pack.v1", Revision: t.Revision, TemplateID: t.Scope.PurposeID + ".v1", Audience: t.Scope.Audience, Language: t.Language, Brief: "관찰된 현상과 미확인 사항을 정리하고 조사를 요청한다.", Facts: []domain.Fact{}, Required: []string{}, Tables: []domain.Table{}, Excerpts: []domain.Slot{}, Assets: []domain.Slot{}, ToolResults: []any{}}
	allowedConflicts := map[string]bool{}
	for _, c := range t.Candidates {
		d, ok := t.Decisions[c.ID]
		if !ok {
			if c.Required {
				return p, errors.New("NEEDS_DECISIONS")
			}
			continue
		}
		if !Active(d, t, rules, now) {
			return p, errors.New("APPROVAL_EXPIRED")
		}
		if d.Disposition == "defer" {
			return p, errors.New("NEEDS_DECISIONS")
		}
		if d.Disposition == "exclude" {
			continue
		}
		if c.ConflictGroup != "" {
			if allowedConflicts[c.ConflictGroup] {
				return p, errors.New("SOURCE_CONFLICT")
			}
			allowedConflicts[c.ConflictGroup] = true
		}
		pr, e := ProjectFor(t, c, d.Representation, d.RawGrants)
		if e != nil {
			return p, e
		}
		if domain.Hash(domain.Canonical(pr)) != d.ProjectionSHA {
			return p, errors.New("INVALID_DECISION")
		}
		if c.Kind == "config_example" {
			p.Assets = append(p.Assets, domain.Slot{ID: "config_example", Bytes: ConfigBytes()})
		}
		if len(pr.Excerpt) > 0 {
			p.Excerpts = append(p.Excerpts, domain.Slot{ID: fmt.Sprintf("ex_%d", len(p.Excerpts)+1), Bytes: pr.Excerpt})
		}
		if pr.Statement != "" {
			id := fmt.Sprintf("f_%d", len(p.Facts)+1)
			p.Facts = append(p.Facts, domain.Fact{ID: id, Kind: c.Kind, Statement: pr.Statement})
			if c.Required {
				p.Required = append(p.Required, id)
			}
		}
		if len(pr.Columns) > 0 {
			numeric := []int{}
			if d.Representation.Kind == "selected_fields" && d.Representation.Parameters["include_count"] == 1 {
				col := 0
				if d.Representation.Parameters["include_observation"] == 1 {
					col = 1
				}
				numeric = []int{col}
			}
			if d.Representation.Kind == "exact_value" || d.Representation.TransformID == "series_index_base100.v1" {
				numeric = []int{1}
			}

			prefix := "observations"
			if c.Kind == "timeline" {
				prefix = "timeline"
			}
			count := 0
			for _, table := range p.Tables {
				if strings.HasPrefix(table.FileName, prefix) {
					count++
				}
			}
			name := prefix + ".csv"
			if count > 0 {
				name = fmt.Sprintf("%s-%d.csv", prefix, count+1)
			}

			p.Tables = append(p.Tables, domain.Table{FileName: name, NumericColumns: numeric, ID: fmt.Sprintf("tb_%d", len(p.Tables)+1), Columns: pr.Columns, Rows: pr.Rows})
		}
	}
	if len(p.Facts)+len(p.Tables)+len(p.Excerpts) == 0 {
		return p, errors.New("NO_PUBLIC_FACTS")
	}
	return p, nil
}
func Reusable(c domain.Candidate, r domain.Representation) bool {
	return c.Kind == "series" && c.Selector != "" && (r.Kind == "fact_summary" || r.Kind == "derived_table") && strings.HasPrefix(c.Selector, "csv:")
}
