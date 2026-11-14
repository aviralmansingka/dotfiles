package main

import (
	"testing"

	lg "charm.land/lipgloss/v2"
)

// The Rex floating layer in rex/notes.lua is cut to the card's footprint, so the
// card must not grow past it: a wider or taller card there is clipped, and the
// frame loses its border. Keep the numbers in that file and this one in step.
func TestCardFootprint(t *testing.T) {
	const layerW, layerH = 64, 11
	m := newModel(true, "", t.TempDir())
	m.w, m.h = layerW, layerH
	m.layout()

	collapsed := m.card()
	if w, h := lg.Width(collapsed), lg.Height(collapsed); w != layerW || h != layerH-1 {
		t.Errorf("card with detail hidden = %dx%d, want %dx%d", w, h, layerW, layerH-1)
	}

	m.shown = true
	revealed := m.card()
	if w, h := lg.Width(revealed), lg.Height(revealed); w != layerW || h != layerH {
		t.Errorf("card with detail shown = %dx%d, want %dx%d", w, h, layerW, layerH)
	}
	if frame := m.frame(); lg.Height(frame) != layerH || lg.Width(frame) > layerW {
		t.Errorf("frame clips the layer: %dx%d in %dx%d", lg.Width(frame), lg.Height(frame), layerW, layerH)
	}
}
