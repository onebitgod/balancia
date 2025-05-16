package upstream

import (
	"net/http/httputil"
	"net/url"
	"sync"
)

// Upstream holds the data about a upstream servers
type Upstream struct {
	URL          *url.URL
	PreserveHost bool
	Alive        bool
	mux          sync.RWMutex
	ReverseProxy *httputil.ReverseProxy
}

// UpstreamPool holds information about reachable upstreams
type UpstreamPool struct {
	Upstreams []*Upstream
	current   uint64
}
