package contextbuilder

import (
	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
)

func (b builder) images(m domain.Message) []llm.Image {
	if !b.in.Self.SupportsImages {
		return nil
	}
	out := []llm.Image{}
	for _, a := range m.Attachments {
		if a.Kind == "image" {
			out = append(out, llm.Image{ID: a.ID, MIME: a.MIME, Width: a.Width, Height: a.Height})
		}
	}
	return out
}
func (b builder) imageCost(m domain.Message) int {
	n := 0
	for _, i := range b.images(m) {
		n += llm.ImageTokens(i)
	}
	return n
}
