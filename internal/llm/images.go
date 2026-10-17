package llm

import (
	"encoding/base64"
	"errors"
	"io"
	"strings"
)

// Image 在预算筛选前仅持有元数据，Base64 在窗口选定后才加载。
type Image struct {
	ID            string
	MIME          string
	Base64        string
	Width, Height int
}

func (i Image) Validate() error {
	switch i.MIME {
	case "image/png", "image/jpeg", "image/webp":
	default:
		return errors.New("模型图片格式不支持，请使用 PNG、JPEG 或 WebP")
	}
	if len(i.Base64) == 0 || len(i.Base64) > base64.StdEncoding.EncodedLen(10<<20) {
		return errors.New("模型图片数据为空或超过 10 MiB")
	}
	if _, err := io.Copy(io.Discard, base64.NewDecoder(base64.StdEncoding.Strict(), strings.NewReader(i.Base64))); err != nil {
		return errors.New("模型图片编码无效，请重新添加")
	}
	return nil
}

// ImageTokens 是跨厂商预算用的保守粗估，不能用来计算实际费用。
func ImageTokens(i Image) int {
	return 1024 + ((max(1, i.Width)+511)/512)*((max(1, i.Height)+511)/512)*512
}
