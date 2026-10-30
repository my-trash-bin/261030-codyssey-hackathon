package llm

import (
	"os"
	"safehandoff.local/poc/internal/domain"
	"strings"
	"testing"
)

func TestSharedCorpus(t *testing.T) {
	entries, e := os.ReadDir("../../contracts/examples")
	if e != nil {
		t.Fatal(e)
	}
	for _, en := range entries {
		b, e := os.ReadFile("../../contracts/examples/" + en.Name())
		if e != nil {
			t.Fatal(e)
		}
		var out any = &Analysis{}
		if strings.HasPrefix(en.Name(), "draft") {
			out = &domain.Draft{}
		}
		e = Parse(string(b), out)
		invalid := strings.Contains(en.Name(), ".invalid.")
		if (e != nil) != invalid {
			t.Errorf("%s: %v", en.Name(), e)
		}
	}
}
