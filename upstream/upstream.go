package upstream

import (
	"net"
	"net/url"
	"time"

	"github.com/onebitgod/balancia/logger"
)

// SetAlive for this upstream
func (b *Upstream) SetAlive(alive bool) {
	b.mux.Lock()
	b.Alive = alive
	b.mux.Unlock()
}

// IsAlive returns true when upstream is alive
func (b *Upstream) IsAlive() (alive bool) {
	b.mux.RLock()
	alive = b.Alive
	b.mux.RUnlock()
	return
}

func isUpstreamAlive(u *url.URL) bool {
	timeout := 2 * time.Second
	conn, err := net.DialTimeout("tcp", u.Host, timeout)
	if err != nil {
		logger.Errorf("Site unreachable, error: %v", err)
		return false
	}
	defer conn.Close()
	return true
}
