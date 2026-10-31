// safehandoff-engine runs independently from the interactive web gateway.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"safehandoff.local/poc/internal/envfile"
	"safehandoff.local/poc/internal/llm"
	"safehandoff.local/poc/internal/regeneration"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
func run() error {
	mode := flag.String("mode", "demo", "demo or live")
	listen := flag.String("listen", "127.0.0.1:8091", "engine loopback address")
	config := flag.String("config", "config.json", "live provider config")
	action := flag.String("action", "", "CLI: analyze, generate or review; JSON stdin/stdout")
	flag.Parse()
	var engine regeneration.Engine = regeneration.Demo{}
	switch *mode {
	case "demo":
	case "live":
		if err := envfile.Load(".env"); err != nil {
			return err
		}
		c := struct {
			Provider llm.Config `json:"provider"`
		}{Provider: llm.DefaultConfig()}
		b, err := os.ReadFile(*config)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if len(b) > 0 {
			if err = json.Unmarshal(b, &c); err != nil {
				return fmt.Errorf("설정 JSON 형식 오류")
			}
		}
		p, err := llm.NewLive(c.Provider)
		if err != nil {
			return fmt.Errorf("%s", llm.ConfigurationDiagnostic(err))
		}
		engine = &regeneration.Live{Provider: p}
	default:
		return fmt.Errorf("mode는 demo 또는 live여야 합니다")
	}
	if *action != "" {
		b, err := io.ReadAll(io.LimitReader(os.Stdin, (2<<20)+1))
		if err != nil {
			return err
		}
		if len(b) > 2<<20 {
			return fmt.Errorf("INPUT_TOO_LARGE")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		var result any
		switch *action {
		case "analyze":
			var v regeneration.Input
			err = regeneration.Decode(b, &v)
			if err == nil {
				result, err = engine.Analyze(ctx, v)
			}
		case "generate":
			var v regeneration.GenerateInput
			err = regeneration.Decode(b, &v)
			if err == nil {
				result, err = engine.Generate(ctx, v)
			}
		case "review":
			var v regeneration.ReviewInput
			err = regeneration.Decode(b, &v)
			if err == nil {
				result, err = engine.Review(ctx, v)
			}
		default:
			return fmt.Errorf("지원하지 않는 action")
		}
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	}
	host, _, err := net.SplitHostPort(*listen)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("엔진은 loopback IP에만 바인딩합니다")
	}
	server := &http.Server{Addr: *listen, Handler: regeneration.Handler(engine), ReadHeaderTimeout: 5 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(shutdown)
	}()
	log.Printf("regeneration engine mode=%s listen=%s", engine.Mode(), *listen)
	err = server.ListenAndServe()
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
