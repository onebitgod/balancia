package conf

import (
	"flag"
	"os"

	"github.com/onebitgod/balancia/logger"
	"gopkg.in/yaml.v3"
)

func Load() (conf *Conf) {
	var yamlPath string

	flag.StringVar(&yamlPath, "conf", "", "conf.yaml required for initial configuration")
	flag.Parse()

	if len(yamlPath) == 0 {
		logger.Warn("No path to conf.yaml is provided.")
	}

	var confPath string

	if len(yamlPath) == 0 {
		confPath = "./conf.yaml"
	} else {
		confPath = yamlPath
	}

	data, err := os.ReadFile(confPath)

	if len(yamlPath) == 0 && err != nil {
		logger.Warnf("No conf.yaml is found in current directory. Use --conf=path/to/conf.yaml.")
	}

	if err != nil {
		logger.Errorf("Failed to read YAML file: %s", err)
		return
	}

	err = yaml.Unmarshal(data, &conf)
	if err != nil {
		logger.Errorf("Failed to parse YAML: %v", err)
	}

	return
}
