# Installation-time build only; repro is compiled offline from main.go before this build.
FROM scratch
COPY repro /repro
USER 65532:65532
ENTRYPOINT ["/repro"]
