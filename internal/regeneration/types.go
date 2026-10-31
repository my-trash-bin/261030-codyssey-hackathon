// Package regeneration implements the standalone, stateless sharing engine.
package regeneration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
)

type Source struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Text string `json:"text"`
}
type Input struct {
	Scenario  string   `json:"scenario,omitempty"`
	Purpose   string   `json:"purpose"`
	Recipient string   `json:"recipient"`
	Sources   []Source `json:"sources"`
}
type Candidate struct {
	ID        string   `json:"id"`
	Text      string   `json:"text"`
	Reason    string   `json:"reason"`
	SourceIDs []string `json:"source_ids"`
}
type Analysis struct {
	Mode       string      `json:"mode"`
	InputHash  string      `json:"input_hash"`
	Candidates []Candidate `json:"candidates"`
}

// Approved facts are explicit user decisions. Raw sources never enter generation.
type Fact struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}
type GenerateInput struct {
	Purpose   string `json:"purpose"`
	Recipient string `json:"recipient"`
	Facts     []Fact `json:"facts"`
}
type Document struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}
type Review struct {
	Pass   bool     `json:"pass"`
	Issues []string `json:"issues"`
}
type Result struct {
	Mode      string   `json:"mode"`
	InputHash string   `json:"input_hash"`
	Document  Document `json:"document"`
	Review    Review   `json:"review"`
}
type ReviewInput struct {
	GenerateInput
	Document Document `json:"document"`
}
type Engine interface {
	Mode() string
	Analyze(context.Context, Input) (Analysis, error)
	Generate(context.Context, GenerateInput) (Result, error)
	Review(context.Context, ReviewInput) (Review, error)
}

func Hash(v any) string {
	b, _ := json.Marshal(v)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
func validateInput(v Input) error {
	if strings.TrimSpace(v.Purpose) == "" || strings.TrimSpace(v.Recipient) == "" || len(v.Sources) == 0 || len(v.Sources) > 10 {
		return errors.New("INVALID_INPUT")
	}
	ids := map[string]bool{}
	for _, s := range v.Sources {
		if s.ID == "" || ids[s.ID] || strings.TrimSpace(s.Text) == "" {
			return errors.New("INVALID_SOURCE")
		}
		ids[s.ID] = true
	}
	return nil
}
func validateFacts(v GenerateInput) error {
	if strings.TrimSpace(v.Purpose) == "" || strings.TrimSpace(v.Recipient) == "" || len(v.Facts) == 0 || len(v.Facts) > 40 {
		return errors.New("NO_APPROVED_FACTS")
	}
	ids := map[string]bool{}
	for _, f := range v.Facts {
		if f.ID == "" || ids[f.ID] || strings.TrimSpace(f.Text) == "" {
			return errors.New("INVALID_FACT")
		}
		ids[f.ID] = true
	}
	return nil
}
