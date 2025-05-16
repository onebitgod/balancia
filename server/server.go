package server

import (
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/onebitgod/balancia/conf"
	"github.com/onebitgod/balancia/logger"
	"github.com/onebitgod/balancia/upstream"
)

func CreateServer(conf conf.Conf) {

	hbMap := make(HBMap)

	for _, spec := range conf.Specs {
		puMap := make(PUMap)
		for _, path := range spec.Paths {
			puMap[path.Path] = upstream.CreatePool(path.Backend.Upstreams)
		}
		hbMap[spec.Host] = puMap
	}

	// var hbMap *HBMap =

	var confMap *ConfMap = &ConfMap{
		hbMap: hbMap,
	}

	server := http.Server{
		Addr:    fmt.Sprintf(":%d", conf.Port),
		Handler: http.HandlerFunc(confMap.httpHandler),
	}

	// start health checking
	// go s.HealthCheck()

	logger.Infof("Balancia started at :%d\n", conf.Port)
	if err := server.ListenAndServe(); err != nil {
		logger.Errorf("Error while creating upstream pool %v", err)
	}

}

func (confMap *ConfMap) httpHandler(w http.ResponseWriter, r *http.Request) {

	log.Printf("%v :%v: %v", r.URL, r.Host, r.Header)

	pathSegments := strings.Split(r.URL.Path, "/")

	if len(pathSegments) < 2 {
		logger.Infof("No path found in the request: %v", pathSegments)
		http.Error(w, "Service not available", http.StatusServiceUnavailable)
		return
	}

	path := "/" + pathSegments[1]
	host := strings.Split(r.Host, ":")[0]

	b := confMap.hbMap[host][path]

	if b == nil || len(b.Upstreams) == 0 {
		logger.Infof("%v Path not found :-> %v", path, r.Host+r.RequestURI)
		http.Error(w, "Service not available", http.StatusServiceUnavailable)
		return
	}

	b.LB(w, r)

}
