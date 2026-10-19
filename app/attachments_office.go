package app

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"ai-group-chat/internal/domain"

	"github.com/xuri/excelize/v2"
)

const (
	maxOfficeEntries      = 2048
	maxOfficeUncompressed = 128 << 20
	maxOfficePartBytes    = 16 << 20
)

func officeZip(data []byte) (*zip.Reader, error) {
	if !bytes.HasPrefix(data, []byte("PK\x03\x04")) {
		return nil, errors.New("文件不是有效的 Office 文档")
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("Office 文档已损坏或格式无效")
	}
	if len(zr.File) > maxOfficeEntries {
		return nil, errors.New("Office 文档包含过多文件，请拆分后重试")
	}
	var total uint64
	for _, f := range zr.File {
		total += f.UncompressedSize64
		if total > maxOfficeUncompressed {
			return nil, errors.New("Office 文档解压后过大，请拆分后重试")
		}
	}
	return zr, nil
}

func readZipPart(zr *zip.Reader, name string, limit int64) ([]byte, error) {
	for _, f := range zr.File {
		if f.Name != name {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, errors.New("Office 文档内容损坏，无法读取")
		}
		defer rc.Close()
		body, err := io.ReadAll(io.LimitReader(rc, limit+1))
		if err != nil {
			return nil, errors.New("Office 文档内容损坏，无法读取")
		}
		if int64(len(body)) > limit {
			return nil, errors.New("Office 文档正文过大，请拆分后重试")
		}
		return body, nil
	}
	return nil, errOfficePartMissing
}

var errOfficePartMissing = errors.New("Office 文档缺少正文")

// officeXMLText 保留段落、制表符和换行；只读取文字节点，不执行文档脚本。
func officeXMLText(body []byte) (string, error) {
	dec := xml.NewDecoder(bytes.NewReader(body))
	var b strings.Builder
	inText := false
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", errors.New("Office 文档正文不是有效 XML")
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "p":
				if b.Len() > 0 {
					b.WriteByte('\n')
				}
			case "t":
				inText = true
			case "tab":
				b.WriteByte('\t')
			case "br":
				b.WriteByte('\n')
			}
		case xml.CharData:
			if inText {
				b.Write(t)
			}
		case xml.EndElement:
			if t.Name.Local == "t" {
				inText = false
			}
		}
	}
	return strings.TrimSpace(b.String()), nil
}

func extractDOCX(data []byte) (string, int, error) {
	zr, err := officeZip(data)
	if err != nil {
		return "", 0, err
	}
	body, err := readZipPart(zr, "word/document.xml", maxOfficePartBytes)
	if err != nil {
		return "", 0, err
	}
	text, err := officeXMLText(body)
	if err != nil {
		return "", 0, err
	}
	if text == "" {
		return "", 0, errors.New("Word 文档没有可提取的文字")
	}
	pages := 0
	if app, err := readZipPart(zr, "docProps/app.xml", 1<<20); err == nil {
		pages = officePages(app)
	}
	return text, pages, nil
}

func officePages(body []byte) int {
	dec := xml.NewDecoder(bytes.NewReader(body))
	inPages := false
	for {
		tok, err := dec.Token()
		if err != nil {
			return 0
		}
		switch t := tok.(type) {
		case xml.StartElement:
			inPages = t.Name.Local == "Pages"
		case xml.CharData:
			if inPages {
				n, _ := strconv.Atoi(strings.TrimSpace(string(t)))
				return n
			}
		case xml.EndElement:
			inPages = false
		}
	}
}

var slidePattern = regexp.MustCompile(`^ppt/slides/slide(\d+)\.xml$`)

func extractPPTX(data []byte) (string, int, error) {
	zr, err := officeZip(data)
	if err != nil {
		return "", 0, err
	}
	type slide struct {
		number int
		name   string
	}
	slides := []slide{}
	for _, f := range zr.File {
		if m := slidePattern.FindStringSubmatch(f.Name); m != nil {
			n, _ := strconv.Atoi(m[1])
			slides = append(slides, slide{number: n, name: f.Name})
		}
	}
	if len(slides) == 0 {
		return "", 0, errors.New("PowerPoint 文档没有找到幻灯片")
	}
	sort.Slice(slides, func(i, j int) bool { return slides[i].number < slides[j].number })
	parts := make([]string, 0, len(slides))
	for _, s := range slides {
		body, err := readZipPart(zr, s.name, maxOfficePartBytes)
		if err != nil {
			return "", 0, err
		}
		text, err := officeXMLText(body)
		if err != nil {
			return "", 0, err
		}
		if text != "" {
			parts = append(parts, fmt.Sprintf("[第 %d 页]\n%s", s.number, text))
		}
	}
	text := strings.TrimSpace(strings.Join(parts, "\n\n"))
	if text == "" {
		return "", 0, errors.New("PowerPoint 文档没有可提取的文字")
	}
	return text, len(slides), nil
}

func extractXLSX(data []byte) (string, int, error) {
	if _, err := officeZip(data); err != nil {
		return "", 0, err
	}
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return "", 0, errors.New("Excel 文档已损坏或格式无效")
	}
	defer f.Close()
	var b strings.Builder
	chars := 0
	for _, sheet := range f.GetSheetList() {
		header := "[工作表：" + sheet + "]\n"
		b.WriteString(header)
		chars += utf8.RuneCountInString(header)
		rows, err := f.Rows(sheet)
		if err != nil {
			return "", 0, errors.New("Excel 工作表无法读取")
		}
		for rows.Next() {
			cols, err := rows.Columns()
			if err != nil {
				rows.Close()
				return "", 0, errors.New("Excel 单元格无法读取")
			}
			line := strings.Join(cols, "\t") + "\n"
			b.WriteString(line)
			chars += utf8.RuneCountInString(line)
			if chars > domain.MaxDocumentRunes {
				rows.Close()
				return "", 0, errors.New("文档文字不能超过 100000 字符，请拆分后重新添加")
			}
		}
		if err := rows.Close(); err != nil {
			return "", 0, errors.New("Excel 工作表无法关闭")
		}
		b.WriteByte('\n')
	}
	text := strings.TrimSpace(b.String())
	if text == "" {
		return "", 0, errors.New("Excel 文档没有可提取的文字")
	}
	return text, 0, nil
}
