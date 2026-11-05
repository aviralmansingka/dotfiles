package main

import (
	"mission.local/prototype/internal/platform"
)

// cmdAsk writes one durable question for the commander, or lists the mission's
// asks. A captain holds no mission token, so this command asks for none: the
// ask file is the channel, and the commander's session drains it.
func cmdAsk(a platform.Args, s *App) (any, error) {
	if a.Has("list") {
		return s.asks(a.At(1))
	}
	return s.ask(a.At(1), askInput{Text: a.Get("text"), Step: a.Get("step"), Attempt: a.Get("attempt"), Kind: a.Get("kind")})
}
