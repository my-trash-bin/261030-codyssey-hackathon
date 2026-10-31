package regeneration

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

func Handler(engine Engine) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"mode": engine.Mode(), "protocol": "regeneration.v1"})
	})
	mux.HandleFunc("GET /v1/scenarios", func(w http.ResponseWriter, r *http.Request) {
		if engine.Mode() != "demo" {
			writeJSON(w, 200, []Scenario{})
			return
		}
		writeJSON(w, 200, Scenarios())
	})
	for _, action := range []string{"analyze", "generate", "review"} {
		mux.HandleFunc("POST /v1/"+action, func(w http.ResponseWriter, r *http.Request) {
			var input any
			switch action {
			case "analyze":
				input = &Input{}
			case "generate":
				input = &GenerateInput{}
			case "review":
				input = &ReviewInput{}
			}
			r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
			data, err := io.ReadAll(r.Body)
			if err != nil || Decode(data, input) != nil {
				writeJSON(w, 400, map[string]string{"error": "INVALID_JSON"})
				return
			}

			var result any
			err = nil
			switch v := input.(type) {
			case *Input:
				result, err = engine.Analyze(r.Context(), *v)
			case *GenerateInput:
				result, err = engine.Generate(r.Context(), *v)
			case *ReviewInput:
				result, err = engine.Review(r.Context(), *v)
			}
			if err != nil {
				code := err.Error()
				if strings.ContainsAny(code, " \r\n:") || len(code) > 80 {
					code = "ENGINE_FAILED"
				}
				writeJSON(w, 422, map[string]string{"error": code})
				return
			}
			writeJSON(w, 200, result)
		})
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		// Engine is server-to-server/CLI only; browsers use the web gateway.
		if r.Header.Get("Origin") != "" {
			writeJSON(w, 403, map[string]string{"error": "USE_WEB_GATEWAY"})
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
