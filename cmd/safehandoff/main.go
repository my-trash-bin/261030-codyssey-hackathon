package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"safehandoff.local/poc/internal/domain"
	"safehandoff.local/poc/internal/httpapi"
	"safehandoff.local/poc/internal/llm"
	"safehandoff.local/poc/internal/store"
	"safehandoff.local/poc/internal/workflow"
	"syscall"
	"time"
)

type config struct {
	Server struct {
		Listen string `json:"listen"`
	} `json:"server"`
	DataDir  string     `json:"data_dir"`
	Provider llm.Config `json:"provider"`
	Workflow struct {
		Repairs int `json:"max_review_repairs"`
		Calls   int `json:"max_model_calls_per_run"`
	} `json:"workflow"`
	Limits struct {
		Files       int `json:"max_files"`
		FileBytes   int `json:"max_file_bytes"`
		SourceBytes int `json:"max_task_source_bytes"`
		ExportBytes int `json:"max_export_bytes"`
	} `json:"limits"`
	Reproduction struct {
		Enabled bool   `json:"enabled"`
		Runner  string `json:"runner"`
	} `json:"reproduction"`
}

func main() {
	path := flag.String("config", "config.json", "설정 JSON")
	fixture := flag.Bool("fixture", false, "개발 전용 fixture provider")
	data := flag.String("data-dir", "", "저장 폴더 덮어쓰기")
	listen := flag.String("listen", "", "로컬 수신 주소 덮어쓰기")
	seed := flag.Bool("seed-demo", false, "demo 전용 미승인 작업 생성 후 종료")
	flag.Parse()
	var c config
	c.Server.Listen = "127.0.0.1:8080"
	c.DataDir = "./var/safehandoff"
	c.Provider = llm.DefaultConfig()
	c.Workflow.Repairs = 2
	c.Workflow.Calls = 12
	if b, e := os.ReadFile(*path); e == nil {
		if e = domain.Strict(b, &c); e != nil {
			log.Fatal("설정 파일 형식 오류: ", e)
		}
	} else if !os.IsNotExist(e) {
		log.Fatal(e)
	}
	if *data != "" {
		c.DataDir = *data
	}
	if *listen != "" {
		c.Server.Listen = *listen
	}
	host, _, e := net.SplitHostPort(c.Server.Listen)
	if e != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		log.Fatal("로컬 loopback IP 주소만 허용합니다")
	}
	var p llm.Provider
	if *fixture {
		p = llm.Fixture{}
	} else {
		live, e := llm.NewLive(c.Provider)
		if e != nil {
			log.Fatal("live 설정 대기: ", e)
		}
		p = live
	}
	db, e := store.Open(c.DataDir)
	if e != nil {
		log.Fatal(e)
	}
	defer db.Close()
	svc := workflow.New(db, p)
	svc.MaxInput = c.Provider.MaxInput
	svc.MaxCalls = c.Workflow.Calls
	svc.Repairs = c.Workflow.Repairs
	svc.Attempts = c.Provider.MaxAttempts
	defer svc.Close()
	if *seed {
		if c.DataDir != "./var/demo" {
			log.Fatal("seed-demo는 ./var/demo만 허용합니다")
		}
		for _, scenario := range []struct{ Name, Purpose string }{{"oss-encoding", "oss_issue"}, {"b2b-timeout", "vendor_support"}, {"internal-operations", "operations_advice"}} {
			t, e := svc.Create("가상 시연: "+scenario.Name, domain.Scope{ProjectID: "project_demo", PurposeID: scenario.Purpose, RecipientID: "recipient_vendorstore", Audience: "named_external"}, "ko")
			if e != nil {
				log.Fatal(e)
			}
			entries, e := os.ReadDir("fixtures/author/" + scenario.Name)
			if e != nil {
				log.Fatal(e)
			}
			for _, entry := range entries {
				b, e := os.ReadFile("fixtures/author/" + scenario.Name + "/" + entry.Name())
				if e != nil {
					log.Fatal(e)
				}
				format := "txt"
				for _, f := range []string{"csv", "md", "log", "json"} {
					if len(entry.Name()) > len(f) && entry.Name()[len(entry.Name())-len(f):] == f {
						format = f
					}
				}
				src := domain.Source{ID: domain.ID("srcv"), SourceID: domain.ID("source"), Version: 1, Name: entry.Name(), Format: format, Slot: "requests_v1", Raw: b, SHA: domain.Hash(b), Included: true}
				t.Sources = append(t.Sources, src)
				t.Evidence = append(t.Evidence, domain.EvidenceFor(src)...)
			}
			old := t.Revision
			t.Invalidate("needs_analysis")
			if e = db.Save(t, old); e != nil {
				log.Fatal(e)
			}
			out, _ := json.Marshal(map[string]string{"task_id": t.ID, "scenario": scenario.Name})
			fmt.Println(string(out))
		}
		return
	}
	server := &http.Server{Addr: c.Server.Listen, Handler: httpapi.New(svc, c.Server.Listen), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	}()
	log.Printf("SafeHandoff %s: http://%s", p.Mode(), c.Server.Listen)
	if e = server.ListenAndServe(); e != nil && e != http.ErrServerClosed {
		log.Fatal(e)
	}
}
