package logger

import (
	"fmt"
)

// ANSI codes maps

type escapeStyle struct {
	reset         string
	bold          string
	dim           string
	italic        string
	underline     string
	blink         string
	invert        string
	hidden        string
	strikethrough string
}

type escapeColor struct {
	reset   string
	black   string
	red     string
	green   string
	yellow  string
	blue    string
	magenta string
	cyan    string
	white   string
	gray    string
}

type escapeCodes struct {
	bg *escapeColor
	fg *escapeColor
	st *escapeStyle
}

var EscapeCodes *escapeCodes = &escapeCodes{
	bg: BgEscapeColor,
	fg: FgEscapeColor,
	st: EscapeStyle,
}

var EscapeStyle *escapeStyle = &escapeStyle{
	reset:         styles["reset"],
	bold:          styles["bold"],
	dim:           styles["dim"],
	italic:        styles["italic"],
	underline:     styles["underline"],
	blink:         styles["blink"],
	invert:        styles["invert"],
	hidden:        styles["hidden"],
	strikethrough: styles["strikethrough"],
}

var FgEscapeColor *escapeColor = &escapeColor{
	reset:   fgColors["reset"],
	black:   fgColors["black"],
	red:     fgColors["red"],
	green:   fgColors["green"],
	yellow:  fgColors["yellow"],
	blue:    fgColors["blue"],
	magenta: fgColors["magenta"],
	cyan:    fgColors["cyan"],
	white:   fgColors["white"],
	gray:    fgColors["gray"],
}

var BgEscapeColor *escapeColor = &escapeColor{
	reset:   bgColors["reset"],
	black:   bgColors["black"],
	red:     bgColors["red"],
	green:   bgColors["green"],
	yellow:  bgColors["yellow"],
	blue:    bgColors["blue"],
	magenta: bgColors["magenta"],
	cyan:    bgColors["cyan"],
	white:   bgColors["white"],
	gray:    bgColors["gray"],
}

type Logtext string

func (text Logtext) format(style, fgColor, bgColor string) string {
	return fmt.Sprintf("\033[%s;%s;%sm%s\033[0m", style, bgColor, fgColor, text)
}
