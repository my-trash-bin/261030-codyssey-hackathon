package main

import (
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"math/rand/v2"
	"os"
	"path/filepath"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/tools"
	"strings"
)

func main() {
	scenario := flag.String("scenario", "b2b-timeout", "oss-encoding / b2b-timeout / internal-operations")
	seed := flag.Uint64("seed", 41, "고정 seed")
	variation := flag.String("variation", "baseline", "사전 정의 변형")
	out := flag.String("out", "./var/demo-inputs", "출력 폴더")
	flag.Parse()
	valid := map[string]bool{"baseline": true, "middle-decrease": true, "source-conflict": true, "ids-excluded": true, "recipient-changed": true, "wrong-target": true, "checker-error": true}
	if !valid[*variation] || (*scenario != "oss-encoding" && *scenario != "b2b-timeout" && *scenario != "internal-operations") {
		fmt.Fprintln(os.Stderr, "지원하지 않는 scenario/variation")
		os.Exit(1)
	}
	entries, e := os.ReadDir("fixtures/author/" + *scenario)
	if e != nil {
		panic(e)
	}
	if e = os.MkdirAll(*out, 0700); e != nil {
		panic(e)
	}
	hashes := map[string]string{}
	rng := rand.New(rand.NewPCG(*seed, 41))
	for _, en := range entries {
		raw, e := os.ReadFile("fixtures/author/" + *scenario + "/" + en.Name())
		if e != nil {
			panic(e)
		}
		if strings.HasSuffix(en.Name(), ".csv") && (*seed != 41 || *variation == "middle-decrease") {
			rows, e := csv.NewReader(strings.NewReader(string(raw))).ReadAll()
			if e != nil {
				panic(e)
			}
			if len(rows) >= 4 && len(rows[0]) == 2 {
				vals := []int{820, 1160, 1740}
				if *seed != 41 {
					vals = []int{100 + rng.IntN(500), 700 + rng.IntN(200), 1200 + rng.IntN(400)}
				}
				if *variation == "middle-decrease" {
					vals[1] = vals[0] - 40
				}
				var sb strings.Builder
				w := csv.NewWriter(&sb)
				w.Write(rows[0])
				for i := 1; i < len(rows); i++ {
					rows[i][1] = fmt.Sprint(vals[(i-1)%3])
					w.Write(rows[i])
				}
				w.Flush()
				raw = []byte(sb.String())
			}
		}
		if *variation == "source-conflict" && en.Name() == "support-notes.md" {
			raw = append(raw, []byte("\n충돌 자료: 최초 서버 요청은 완료됐다고 다른 메모에서 주장함. 원본 로그와 확인 필요.\n")...)
		}
		if e = os.WriteFile(filepath.Join(*out, en.Name()), raw, 0600); e != nil {
			panic(e)
		}
		hashes[en.Name()] = domain.Hash(raw)
	}
	a, b, e := tools.Synthetic(*seed, 6)
	if e != nil {
		panic(e)
	}
	for name, raw := range map[string][]byte{"synthetic-ascii.json": a, "synthetic-multibyte.json": b} {
		os.WriteFile(filepath.Join(*out, name), raw, 0600)
		hashes[name] = domain.Hash(raw)
	}
	metadata := map[string]any{"generator_version": "fixtures.v1", "scenario": *scenario, "seed": *seed, "variation": *variation, "source_hashes": hashes, "decision_plan": map[string]any{"ids_allowed": *variation != "ids-excluded", "recipient_changed": *variation == "recipient-changed", "wrong_target": *variation == "wrong-target", "checker_error": *variation == "checker-error"}}
	body, _ := json.MarshalIndent(metadata, "", "  ")
	os.WriteFile(filepath.Join(*out, "fixture-manifest.json"), append(body, '\n'), 0600)
	fmt.Println(string(body))
}
