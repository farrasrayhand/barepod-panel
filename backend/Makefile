# BarePod daemon — build & install helpers.
#
#   make build     compile ./barepod in this directory
#   make install   install it into $(PREFIX)/bin (default /usr/local/bin)
#   make test      run the test suite
#
# `make install` may need sudo for /usr/local/bin. Without root privileges you
# can also use `go install ./cmd/barepod`, which puts the binary in
# $(go env GOPATH)/bin — keep that directory on your PATH and `barepod` works
# from anywhere.

BINARY  := barepod
PREFIX  ?= /usr/local
GO      ?= go
GOFLAGS ?=

.PHONY: build install uninstall test test-race vet fmt clean

build:
	$(GO) build $(GOFLAGS) -o $(BINARY) ./cmd/barepod

install:
	$(GO) build $(GOFLAGS) -o $(PREFIX)/bin/$(BINARY) ./cmd/barepod
	@echo "installed $(PREFIX)/bin/$(BINARY)"
	@command -v $(BINARY) >/dev/null 2>&1 || echo "note: $(PREFIX)/bin is not on your PATH"

uninstall:
	rm -f $(PREFIX)/bin/$(BINARY)

test:
	$(GO) test ./...

test-race:
	$(GO) test -race ./internal/deploy/ ./internal/resources/ ./internal/api/

vet:
	$(GO) vet ./...

fmt:
	gofmt -w .

clean:
	rm -f $(BINARY)
