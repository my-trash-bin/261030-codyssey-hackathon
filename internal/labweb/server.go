// Package labweb serves the interactive workspace and proxies a fixed engine.
// It does not import the regeneration implementation, provider or task store.
package labweb

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

//go:embed static/*
var assets embed.FS

func New(engineURL, listen string) (http.Handler, error) {
	target, err := url.Parse(engineURL)
	if err != nil {
		return nil, fmt.Errorf("invalid engine URL")
	}
	ip := net.ParseIP(target.Hostname())
	if target.Scheme != "http" || ip == nil || !ip.IsLoopback() || target.User != nil || target.Path != "" || target.RawQuery != "" || target.Fragment != "" {
		return nil, fmt.Errorf("engine URL must be an HTTP loopback origin")
	}
	_, port, err := net.SplitHostPort(listen)
	if err != nil {
		return nil, err
	}
	allowed := map[string]bool{}
	host, _, _ := net.SplitHostPort(listen)
	if host == "0.0.0.0" || host == "::" {
		addresses, err := net.InterfaceAddrs()
		if err != nil {
			return nil, err
		}
		for _, address := range addresses {
			if ipnet, ok := address.(*net.IPNet); ok {
				allowed[net.JoinHostPort(ipnet.IP.String(), port)] = true
			}
		}
	} else {
		allowed[net.JoinHostPort(host, port)] = true
	}
	allowed[net.JoinHostPort("127.0.0.1", port)] = true
	allowed[net.JoinHostPort("localhost", port)] = true
	mux := http.NewServeMux()
	proxy := httputil.NewSingleHostReverseProxy(target)
	original := proxy.Director
	proxy.Director = func(r *http.Request) {
		original(r)
		r.URL.Path = strings.TrimPrefix(r.URL.Path, "/api")
		r.Host = target.Host
		r.Header.Del("Origin")
		r.Header.Del("Cookie")
		r.Header.Del("Authorization")
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) { jsonError(w, 502, "ENGINE_UNAVAILABLE") }
	// Explicit routes prevent the web process from becoming a general proxy.
	for _, route := range []string{"GET /api/health", "GET /api/v1/scenarios", "POST /api/v1/analyze", "POST /api/v1/generate", "POST /api/v1/review"} {
		mux.Handle(route, proxy)
	}
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"service":"web","status":"ok"}`))
	})
	sub, _ := fs.Sub(assets, "static")
	mux.Handle("GET /", http.FileServer(http.FS(sub)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		if !allowed[strings.ToLower(r.Host)] {
			jsonError(w, 403, "HOST_FORBIDDEN")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			if err != nil || u.Scheme != "http" || !strings.EqualFold(u.Host, r.Host) || u.User != nil {
				jsonError(w, 403, "ORIGIN_FORBIDDEN")
				return
			}
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			if r.Header.Get("X-Safehandoff-UI") != "1" || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
				jsonError(w, 403, "UI_HEADER_REQUIRED")
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
		}
		mux.ServeHTTP(w, r)
	}), nil
}
func jsonError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": code})
}
