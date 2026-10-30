package toyrecord

import "embed"

//go:embed go.mod target/target.go cmd/*/*.go
var Assets embed.FS
