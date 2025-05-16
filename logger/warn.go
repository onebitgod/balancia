package logger

import (
	"fmt"
	"time"
)

func Warn(rawLog string) {
	now := time.Now()

	timestamp := Logtext(now.Format("03:04:05")+fmt.Sprintf(".%03d", now.Nanosecond()/1e6)).format(EscapeCodes.st.reset, EscapeCodes.fg.magenta, EscapeCodes.bg.reset)
	tag := Logtext("WARN").format(EscapeCodes.st.reset, EscapeCodes.fg.yellow, EscapeCodes.bg.reset)
	log := Logtext(rawLog).format(EscapeCodes.st.reset, EscapeCodes.fg.reset, EscapeCodes.bg.reset)

	fmt.Printf("%s [ %-17s ] %s\n", timestamp, tag, log)
}

func Warnf(format string, args ...any) {
	formattedLog := fmt.Sprintf(format, args...)
	Warn(formattedLog)
}
