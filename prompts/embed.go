package prompts

import "embed"

//go:embed *.v1.txt
var Files embed.FS

func Get(role string) string {
	b, e := Files.ReadFile(role + ".v1.txt")
	if e != nil {
		panic(e)
	}
	return string(b)
}
