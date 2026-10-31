// Package demodata exposes only author-side fictional demo inputs.
package demodata

import "embed"

//go:embed operations/* vendor/* oss/* oss-streamcsv/* b2b-webhook/*
var Files embed.FS
