package upstream

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"sync/atomic"
	"time"

	"github.com/onebitgod/balancia/conf"
	"github.com/onebitgod/balancia/logger"
	"github.com/onebitgod/balancia/utils"
)

type contextKey int

const (
	Attempts contextKey = iota
	Retry    contextKey = iota
)

// addUpstream to the server pool
func (s *UpstreamPool) addUpstream(upstream *Upstream) {

	if s.Upstreams == nil {
		s.Upstreams = make([]*Upstream, 0)
	}

	s.Upstreams = append(s.Upstreams, upstream)
}

// nextIndex atomically increase the counter and return an index
func (s *UpstreamPool) nextIndex() int {
	return int(atomic.AddUint64(&s.current, uint64(1)) % uint64(len(s.Upstreams)))
}

// markUpstreamStatus changes a status of a upstream
func (s *UpstreamPool) markUpstreamStatus(upstreamUrl *url.URL, alive bool) {
	for _, b := range s.Upstreams {
		if b.URL.String() == upstreamUrl.String() {
			b.SetAlive(alive)
			break
		}
	}
}

// getNextPeer returns next active peer to take a connection
func (s *UpstreamPool) getNextPeer() *Upstream {
	// loop entire upstreams to find out an Alive upstream
	next := s.nextIndex()
	l := len(s.Upstreams) + next // start from next and move a full cycle
	for i := next; i < l; i++ {
		idx := i % len(s.Upstreams)     // take an index by modding
		if s.Upstreams[idx].IsAlive() { // if we have an alive upstream, use it and store if its not the original one
			if i != next {
				atomic.StoreUint64(&s.current, uint64(idx))
			}
			return s.Upstreams[idx]
		}
	}
	return nil
}

// HealthCheck pings the upstreams and update the status
func (s *UpstreamPool) HealthCheck() {
	t := time.NewTicker(time.Minute * 2)
	for range t.C {
		logger.Info("Starting health check...")
		for _, b := range s.Upstreams {
			status := "up"
			alive := isUpstreamAlive(b.URL)
			b.SetAlive(alive)
			if !alive {
				status = "down"
			}
			logger.Infof("%s [%s]\n", b.URL, status)
		}
		logger.Info("Health check completed")

	}

}

// lb load balances the incoming request
func (upstreamPool *UpstreamPool) LB(w http.ResponseWriter, r *http.Request) {
	attempts := utils.GetAttemptsFromContext(r, Attempts)
	if attempts > 3 {
		logger.Infof("%s(%s) Max attempts reached, terminating\n", r.RemoteAddr, r.URL.Path)
		http.Error(w, "Service not available", http.StatusServiceUnavailable)
		return
	}

	peer := upstreamPool.getNextPeer()
	if peer != nil {
		logger.Infof("Request %v: %v", r.Host, r.URL)

		// Modify request before proxying
		r.URL.Scheme = peer.URL.Scheme
		r.URL.Host = peer.URL.Host
		r.Host = peer.URL.Host
		// Optionally trim the base path before forwarding
		// r.URL.Path = strings.TrimPrefix(r.URL.Path, c.FullPath())

		peer.ReverseProxy.ServeHTTP(w, r)
		return
	}
	http.Error(w, "Service not available", http.StatusServiceUnavailable)
}

// isAlive checks whether a upstream is Alive by establishing a TCP connection

func CreatePool(upstreams []*conf.Upstream) *UpstreamPool {
	upstreamPool := &UpstreamPool{}
	for _, upstreamConf := range upstreams {

		portString := fmt.Sprintf(":%d", upstreamConf.Port)

		if upstreamConf.Port == 0 {
			portString = ""
		}

		serverUrl, err := url.Parse(fmt.Sprintf("http://%s%s", upstreamConf.Host, portString))

		if err != nil {
			logger.Errorf("Error while creating upstream pool %v", err)
			continue
		}

		logger.Infof("configuring proxy to %s", serverUrl)

		proxy := httputil.NewSingleHostReverseProxy(serverUrl)
		proxy.ErrorHandler = func(writer http.ResponseWriter, request *http.Request, e error) {
			logger.Infof("[%s] %s\n", serverUrl.Host, e.Error())
			retries := utils.GetRetryFromContext(request, Retry)
			if retries < 3 {
				<-time.After(10 * time.Millisecond)
				ctx := context.WithValue(request.Context(), Retry, retries+1)
				proxy.ServeHTTP(writer, request.WithContext(ctx))

				return
			}

			// after 3 retries, mark this upstream as down
			upstreamPool.markUpstreamStatus(serverUrl, false)

			// if the same request routing for few attempts with different upstreams, increase the count
			attempts := utils.GetAttemptsFromContext(request, Attempts)
			logger.Infof("%s(%s) Attempting retry %d\n", request.RemoteAddr, request.URL.Path, attempts)
			ctx := context.WithValue(request.Context(), Attempts, attempts+1)
			upstreamPool.LB(writer, request.WithContext(ctx))
		}

		upstreamPool.addUpstream(&Upstream{
			URL:          serverUrl,
			Alive:        true,
			ReverseProxy: proxy,
		})
	}

	return upstreamPool
}
