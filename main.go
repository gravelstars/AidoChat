package main

import (
	"ai-group-chat/desktop"
	"log"
)

func main() {
	if err := desktop.Run(assets); err != nil {
		log.Fatal(err)
	}
}
