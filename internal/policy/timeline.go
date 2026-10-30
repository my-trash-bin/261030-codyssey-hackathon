package policy

import (
	"errors"
	"fmt"
	"safehandoff.local/poc/internal/domain"
	"strings"
	"time"
)

func Timeline(c domain.Candidate, r domain.Representation) (domain.Projection, error) {
	p := domain.Projection{Columns: []string{}, Rows: [][]string{}}
	if r.Kind == "fact_summary" && r.TransformID == "" && len(r.Parameters) == 0 {
		p.Statement = c.Statement
		return p, nil
	}
	if r.Kind != "derived_table" || len(c.Observations) == 0 {
		return p, errors.New("INVALID_DECISION")
	}
	p.Columns = []string{"사건", "관찰"}
	times := make([]time.Time, len(c.Observations))
	for i, ev := range c.Observations {
		t, e := time.Parse(time.RFC3339Nano, ev.Time)
		if e != nil {
			return p, errors.New("INCOMPLETE")
		}
		times[i] = t
	}
	mode := r.TransformID
	switch mode {
	case "timeline_sequence_only.v1":
		if len(r.Parameters) > 0 {
			return p, errors.New("INVALID_DECISION")
		}
	case "timeline_relative_intervals.v1":
		if len(r.Parameters) > 0 {
			return p, errors.New("INVALID_DECISION")
		}
		p.Columns = append(p.Columns, "첫 사건 대비 간격")
	case "timeline_shifted_absolute.v1", "timeline_synthetic_schedule.v1":
		if len(r.Parameters) != 1 {
			return p, errors.New("INVALID_DECISION")
		}
		if _, ok := r.Parameters["base_epoch_seconds"]; !ok {
			return p, errors.New("INVALID_DECISION")
		}
		p.Columns = append(p.Columns, "시각")
	default:
		return p, errors.New("INVALID_DECISION")
	}
	base := time.Unix(int64(r.Parameters["base_epoch_seconds"]), 0).UTC()
	for i, ev := range c.Observations {
		row := []string{fmt.Sprintf("사건 %d", i+1), ev.Statement}
		switch mode {
		case "timeline_relative_intervals.v1":
			row = append(row, "T+"+times[i].Sub(times[0]).String())
		case "timeline_shifted_absolute.v1":
			row = append(row, base.Add(times[i].Sub(times[0])).Format(time.RFC3339Nano))
		case "timeline_synthetic_schedule.v1":
			row = append(row, base.Add(time.Duration(i)*time.Minute).Format(time.RFC3339)+" (합성 예시)")
		}
		p.Rows = append(p.Rows, row)
	}
	return p, nil
}
func Observations(raw string) []domain.Observation {
	out := []domain.Observation{}
	labels := map[string]string{"request": "요청 전송", "response_timeout": "클라이언트 응답 대기 시간 초과", "retry": "재시도 전송", "response": "응답 수신"}
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if _, e := time.Parse(time.RFC3339Nano, fields[0]); e != nil {
			continue
		}
		for _, field := range fields[1:] {
			if strings.HasPrefix(field, "event=") {
				if label, ok := labels[strings.TrimPrefix(field, "event=")]; ok {
					out = append(out, domain.Observation{Time: fields[0], Statement: label})
				}
			}
		}
	}
	return out
}
