FROM scratch
COPY bin/safehandoff-checker /checker
COPY bin/toy-buggy /buggy
COPY bin/toy-fixed /fixed
COPY bin/toy-probe /probe
USER 65532:65532
