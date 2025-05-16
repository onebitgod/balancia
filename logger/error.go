package logger

import (
	"fmt"
	"time"
)

func Error(rawLog string) {
	now := time.Now()

	timestamp := Logtext(now.Format("03:04:05")+fmt.Sprintf(".%03d", now.Nanosecond()/1e6)).format(EscapeCodes.st.reset, EscapeCodes.fg.magenta, EscapeCodes.bg.reset)
	tag := Logtext("ERROR").format(EscapeCodes.st.reset, EscapeCodes.fg.red, EscapeCodes.bg.reset)
	log := Logtext(rawLog).format(EscapeCodes.st.reset, EscapeCodes.fg.reset, EscapeCodes.bg.reset)

	fmt.Printf("%s [ %-16s ] %s\n", timestamp, tag, log)
}

func Errorf(format string, args ...any) {
	formattedLog := fmt.Sprintf(format, args...)
	Error(formattedLog)
}
