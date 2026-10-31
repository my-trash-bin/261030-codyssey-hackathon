package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"safehandoff.local/poc/internal/labweb"
	"syscall"
	"time"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:8081", "web listen address")
	engine := flag.String("engine", "http://127.0.0.1:8091", "fixed engine URL")
	flag.Parse()
	handler, err := labweb.New(*engine, *listen)
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: *listen, Handler: handler, ReadHeaderTimeout: 5 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(shutdown)
	}()
	log.Printf("interactive web http://%s engine=%s", *listen, *engine)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
