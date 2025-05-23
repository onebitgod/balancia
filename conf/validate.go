package conf

import "github.com/onebitgod/balancia/logger"

func (conf *Conf) Validate() {

	if conf.Port == 0 {
		logger.Warn("Port not provided. Balancia Will serve on default port :80")
	}

	logger.Infof("Balancia is configured to serve on port :%d", conf.Port)

	for i, s := range conf.Specs {
		s.ValidateSpecs(i)
	}
}

func (s *Specs) ValidateSpecs(index int) {

	if len(s.Host) == 0 {
		logger.Warnf("No host defined in the specification at index %d", index)
		logger.Warnf("If no matching host is specified in the configuration, the request will be routed to the first matching path under entries that do not define a host.")
	} else {
		logger.Infof("%s provided at index %d will be served", s.Host, index)
	}

	if len(s.Paths) == 0 {
		logger.Warn("At least provide one service to be served")
		return
	}

	for _, p := range s.Paths {
		p.ValidatePath(s)
	}

}

func (p *Path) ValidatePath(s *Specs) {

	if len(p.Backend.Upstreams) == 0 {
		logger.Warnf("At least provide one upstream for path : %s", p.Path)
		return
	}

	for i, u := range p.Backend.Upstreams {
		if len(u.Host) == 0 {
			logger.Warnf("No upstream host provided at index %d", i)
		}
		port := u.Port
		if u.Port == 0 {
			logger.Warnf("Port not provided for upstream host : %s. Request will be forwarded to default port: 80", u.Host)
			port = 80
		}

		logger.Infof("Upstream host %s:%d will be configured", u.Host, port)
		logger.Infof("Reverse Proxy will be configured is configured for source host %s to %s:%d", s.Host, u.Host, port)
	}

}
