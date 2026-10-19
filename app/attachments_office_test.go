package app

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

func zipFixture(t *testing.T, files map[string]string) string {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for name, body := range files {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = f.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(b.Bytes())
}

func TestAttachmentDOCXAndPPTXExtraction(t *testing.T) {
	docx := zipFixture(t, map[string]string{
		"word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body></w:document>`,
		"docProps/app.xml":  `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>2</Pages></Properties>`,
	})
	a, _, err := validateAttachment(ImportAttachmentInput{Name: "方案.docx", Base64: docx})
	if err != nil {
		t.Fatal(err)
	}
	if a.MIME != docxMIME || !strings.Contains(a.Text, "第一段") || !strings.Contains(a.Text, "第二段") || a.PageCount != 2 {
		t.Fatalf("%+v", a)
	}

	pptx := zipFixture(t, map[string]string{
		"ppt/slides/slide1.xml": `<p:sld xmlns:p="p" xmlns:a="a"><a:t>封面标题</a:t></p:sld>`,
		"ppt/slides/slide2.xml": `<p:sld xmlns:p="p" xmlns:a="a"><a:t>第二张</a:t></p:sld>`,
	})
	a, _, err = validateAttachment(ImportAttachmentInput{Name: "汇报.pptx", Base64: pptx})
	if err != nil {
		t.Fatal(err)
	}
	if a.MIME != pptxMIME || a.PageCount != 2 || !strings.Contains(a.Text, "封面标题") || !strings.Contains(a.Text, "第二张") {
		t.Fatalf("%+v", a)
	}
}

func TestAttachmentXLSXExtraction(t *testing.T) {
	f := excelize.NewFile()
	if err := f.SetCellValue("Sheet1", "A1", "姓名"); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellValue("Sheet1", "B1", "分数"); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellValue("Sheet1", "A2", "小明"); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellValue("Sheet1", "B2", "90"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.NewSheet("汇总"); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellValue("汇总", "A1", "总计"); err != nil {
		t.Fatal(err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	a, _, err := validateAttachment(ImportAttachmentInput{Name: "成绩.xlsx", Base64: base64.StdEncoding.EncodeToString(buf.Bytes())})
	if err != nil {
		t.Fatal(err)
	}
	if a.MIME != xlsxMIME || !strings.Contains(a.Text, "小明") || !strings.Contains(a.Text, "总计") || !strings.Contains(a.Text, "[工作表：汇总]") {
		t.Fatalf("%+v", a)
	}
}

func TestAttachmentTextDataAndLogFiles(t *testing.T) {
	for _, tc := range []struct {
		name string
		mime string
		body string
		want string
	}{
		{"data.csv", "text/csv", "name,score\n小明,90\n", "text/csv"},
		{"data.json", "application/json", `{"ok":true}`, "application/json"},
		{"main.go", "", "package main\nfunc main() {}\n", "text/plain"},
		{"Dockerfile", "", "FROM scratch\n", "text/plain"},
		{"server.log", "", "2026-10-19 INFO ready\n", "text/plain"},
	} {
		a, _, err := validateAttachment(ImportAttachmentInput{Name: tc.name, MIME: tc.mime, Base64: base64.StdEncoding.EncodeToString([]byte(tc.body))})
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if a.MIME != tc.want || !strings.Contains(a.Text, strings.Split(tc.body, "\n")[0]) {
			t.Fatalf("%s: %+v", tc.name, a)
		}
	}
	if _, _, err := validateAttachment(ImportAttachmentInput{Name: "bad.json", Base64: base64.StdEncoding.EncodeToString([]byte(`{"ok":`))}); err == nil {
		t.Fatal("invalid JSON accepted")
	}
	if _, _, err := validateAttachment(ImportAttachmentInput{Name: "bad.docx", Base64: base64.StdEncoding.EncodeToString([]byte("not a zip"))}); err == nil {
		t.Fatal("invalid docx accepted")
	}
}
