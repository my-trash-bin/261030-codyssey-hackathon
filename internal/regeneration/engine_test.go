package regeneration

import (
	"context"
	"encoding/json"
	"errors"
	"safehandoff.local/poc/internal/llm"
	"strings"
	"testing"
)

type fakeProvider struct {
	requests  []llm.Request
	responses []string
}

func (p *fakeProvider) Mode() string { return "test" }
func (p *fakeProvider) Generate(ctx context.Context, r llm.Request) (llm.Response, error) {
	if err := ctx.Err(); err != nil {
		return llm.Response{}, err
	}
	p.requests = append(p.requests, r)
	if len(p.responses) == 0 {
		return llm.Response{}, errors.New("UNEXPECTED_CALL")
	}
	text := p.responses[0]
	p.responses = p.responses[1:]
	return llm.Response{Text: text}, nil
}
func TestLiveBoundaryAndReview(t *testing.T) {
	p := &fakeProvider{responses: []string{
		`{"candidates":[{"id":"c1","text":"응답을 받지 못했습니다.","reason":"관찰","source_ids":["s1"]}]}`,
		`{"title":"처리 결과 문의","body":"응답을 받지 못했습니다. 서버 처리 결과를 확인해 주세요."}`,
		`{"pass":true,"issues":[]}`,
	}}
	engine := &Live{Provider: p}
	input := Input{Purpose: "기술지원", Recipient: "공급사", Sources: []Source{{ID: "s1", Name: "log", Text: "PRIVATE_SOURCE_SENTINEL 응답 없음"}}}
	analysis, err := engine.Analyze(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	facts := GenerateInput{Purpose: input.Purpose, Recipient: input.Recipient, Facts: []Fact{{ID: analysis.Candidates[0].ID, Text: analysis.Candidates[0].Text}}}
	result, err := engine.Generate(context.Background(), facts)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Review.Pass || result.InputHash != Hash(facts) {
		t.Fatal(result)
	}
	if len(p.requests) != 3 || !strings.Contains(p.requests[0].Messages[1].Content, "PRIVATE_SOURCE_SENTINEL") {
		t.Fatal("analysis did not receive source")
	}
	for _, request := range p.requests[1:] {
		if strings.Contains(request.Messages[1].Content, "PRIVATE_SOURCE_SENTINEL") {
			t.Fatal("raw source leaked to writer/reviewer")
		}
	}
}
func TestInvalidReferencesAndReviewFailClosed(t *testing.T) {
	input := Scenarios()[0].Input
	cases := []string{
		`{"candidates":[{"id":"x","text":"fact","reason":"test","source_ids":["unknown"]}]}`,
		`{"candidates":[{"id":"x","text":"fact","reason":"test","source_ids":[]}]}`,
		`{"candidates":[]}`,
	}
	for _, response := range cases {
		p := &fakeProvider{responses: []string{response}}
		if _, err := (&Live{Provider: p}).Analyze(context.Background(), input); err == nil {
			t.Fatalf("accepted %s", response)
		}
	}
	facts := GenerateInput{Purpose: "문의", Recipient: "vendor", Facts: []Fact{{ID: "a", Text: "timeout"}}}
	for _, response := range []string{`{"pass":false}`, `{"pass":true,"issues":["unapproved data"]}`, `{}`} {
		p := &fakeProvider{responses: []string{response}}
		if _, err := (&Live{Provider: p}).Review(context.Background(), ReviewInput{GenerateInput: facts, Document: Document{Title: "title", Body: "body"}}); err == nil {
			t.Fatal("accepted malformed review", response)
		}
	}
}
func TestDemoScenariosAndFreshGeneration(t *testing.T) {
	ctx := context.Background()
	engine := Demo{}
	for _, scenario := range Scenarios() {
		analysis, err := engine.Analyze(ctx, scenario.Input)
		if err != nil {
			t.Fatal(scenario.ID, err)
		}
		if len(analysis.Candidates) < 3 {
			t.Fatal(scenario.ID)
		}
		facts := GenerateInput{Purpose: scenario.Input.Purpose, Recipient: scenario.Input.Recipient, Facts: []Fact{{ID: "a", Text: analysis.Candidates[0].Text}}}
		first, err := engine.Generate(ctx, facts)
		if err != nil {
			t.Fatal(err)
		}
		if !first.Review.Pass || strings.Contains(first.Document.Body, "DEMO_ONLY_SECRET_") {
			t.Fatal("bad demo output")
		}
		facts.Facts = []Fact{{ID: "new", Text: "NEW_APPROVED_FACT"}}
		second, err := engine.Generate(ctx, facts)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(second.Document.Body, analysis.Candidates[0].Text) || first.InputHash == second.InputHash {
			t.Fatal("old approval survived regeneration")
		}
		modified := scenario.Input
		modified.Sources = append([]Source{}, modified.Sources...)
		modified.Sources[0].Text += " changed"
		if _, err := engine.Analyze(ctx, modified); err == nil {
			t.Fatal("scripted response accepted changed data")
		}
	}
	if _, err := engine.Generate(ctx, GenerateInput{}); err == nil {
		t.Fatal("accepted no approvals")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := engine.Analyze(cancelled, Scenarios()[0].Input); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
func TestHTTPRejectsRawSourcesAtGeneration(t *testing.T) {
	b := []byte(`{"purpose":"support","recipient":"vendor","facts":[],"sources":[{"text":"private"}]}`)
	var input GenerateInput
	if err := json.Unmarshal(b, &input); err != nil {
		t.Fatal(err)
	}
	if err := Decode(b, &input); err == nil {
		t.Fatal("strict transport accepted raw sources")
	}
}
