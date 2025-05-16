package server

import "github.com/onebitgod/balancia/upstream"

type ConfMap struct {
	hbMap HBMap
}

// type for map host to backend [path, upstream]
type HBMap map[string]PUMap

// type for map Path to upstream
type PUMap map[string]*upstream.UpstreamPool
