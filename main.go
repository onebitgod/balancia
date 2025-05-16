package main

import (
	"github.com/onebitgod/balancia/conf"
	"github.com/onebitgod/balancia/server"
)

func main() {

	// port := 3031
	// // create http server

	// urls := []string{"http://localhost:8081", "http://localhost:8081"}

	// pool1 := server.CreatePool(urls)
	// pool2 := server.CreatePool(urls)

	// go pool2.Serve(3032)
	// go pool2.Serve(3033)
	// go pool1.Serve(port)

	// server.AddPathPool("/abc", pool1)

	// server.Serve(3031)

	conf := conf.Load()

	server.CreateServer(*conf)
	// logger.Info("this is info")
	// logger.Warn("this is warn")
	// logger.Error("this is error")
	// log.SetPrefix("hello")
	// log.Flags()

	// select {}

}
