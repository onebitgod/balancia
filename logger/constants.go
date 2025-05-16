package logger

var styles = map[string]string{
	"reset":         "0",
	"bold":          "1",
	"dim":           "2",
	"italic":        "3",
	"underline":     "4",
	"blink":         "5",
	"invert":        "7",
	"hidden":        "8",
	"strikethrough": "9",
}

var fgColors = map[string]string{
	"default": "39",
	"black":   "30",
	"red":     "31",
	"green":   "32",
	"yellow":  "33",
	"blue":    "34",
	"magenta": "35",
	"cyan":    "36",
	"white":   "37",
	"gray":    "90",
}

var bgColors = map[string]string{
	"default": "49",
	"black":   "40",
	"red":     "41",
	"green":   "42",
	"yellow":  "43",
	"blue":    "44",
	"magenta": "45",
	"cyan":    "46",
	"white":   "47",
	"gray":    "100",
}
