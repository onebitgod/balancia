package main

import (
	"github.com/onebitgod/balancia/conf"
	"github.com/onebitgod/balancia/server"
)

func main() {

	conf := conf.Load()
	conf.Validate()

	server.CreateServer(*conf)

}
