package conf

type Conf struct {
	Port  int      `yaml:"port"`
	Specs []*Specs `yaml:"specs"`
}

type Specs struct {
	Host  string  `yaml:"host,omitempty"`
	Paths []*Path `yaml:"paths"`
}

type Path struct {
	Backend *Backend `yaml:"backend"`
	Path    string   `yaml:"path"`
}

type Backend struct {
	Upstreams []*Upstream `yaml:"upstreams"`
}

type Upstream struct {
	Host string `yaml:"host"`
	Port int    `yaml:"port"`
}
