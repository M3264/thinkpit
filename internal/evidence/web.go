package evidence

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/M3264/thinkpit/internal/conversation"
	"golang.org/x/net/html"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Result struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Content string `json:"content"`
}
type SearchResponse struct {
	Results  []Result `json:"results"`
	Warnings []string `json:"warnings"`
}

func Search(ctx context.Context, endpoint, query string) (SearchResponse, error) {
	out := SearchResponse{Results: []Result{}, Warnings: []string{}}
	if endpoint == "" {
		return out, errors.New("search is not configured")
	}
	u, err := url.Parse(endpoint)
	if err != nil {
		return out, errors.New("invalid search configuration")
	}
	q := u.Query()
	q.Set("q", query)
	q.Set("format", "json")
	u.RawQuery = q.Encode()
	req, _ := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	client := http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return out, errors.New("search connection failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return out, errors.New("search service unavailable")
	}
	var raw struct {
		Results []Result   `json:"results"`
		Failed  [][]string `json:"unresponsive_engines"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 2*1024*1024)).Decode(&raw) != nil {
		return out, errors.New("invalid search response")
	}
	for _, r := range raw.Results {
		if ValidURL(r.URL) == nil {
			out.Results = append(out.Results, r)
			if len(out.Results) == 10 {
				break
			}
		}
	}
	if len(raw.Failed) > 0 {
		out.Warnings = append(out.Warnings, "Some search engines did not respond; results may be incomplete.")
	}
	return out, nil
}
func ValidURL(value string) error {
	u, err := url.Parse(value)
	if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") || len(value) > 2048 {
		return errors.New("use a public HTTP or HTTPS page URL")
	}
	return nil
}
func PublicIP(ip net.IP) bool {
	return ip != nil && ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast() && !ip.IsUnspecified() && !ip.Equal(net.ParseIP("169.254.169.254")) && !inRange(ip, "100.64.0.0/10") && !inRange(ip, "198.18.0.0/15") && !inRange(ip, "192.0.0.0/24") && !inRange(ip, "0.0.0.0/8") && !inRange(ip, "240.0.0.0/4") && !ip.Equal(net.ParseIP("168.63.129.16"))
}
func inRange(ip net.IP, network string) bool {
	_, n, _ := net.ParseCIDR(network)
	return n.Contains(ip)
}

// Resolve and pin every connection to a validated public IP, including redirects.
func PublicClient() *http.Client {
	transport := &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, errors.New("page host lookup failed")
		}
		if len(ips) == 0 {
			return nil, errors.New("page host has no address")
		}
		for _, ip := range ips {
			if !PublicIP(ip.IP) {
				return nil, errors.New("private or reserved page addresses are not allowed")
			}
		}
		var last error
		for _, ip := range ips {
			conn, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ip.IP.String(), port))
			if err == nil {
				return conn, nil
			}
			last = err
		}
		return nil, last
	}, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 10 * time.Second}
	return &http.Client{Transport: transport, Timeout: 20 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 4 {
			return errors.New("too many page redirects")
		}
		return ValidURL(req.URL.String())
	}}
}
func Fetch(ctx context.Context, value string) (conversation.Evidence, error) {
	out := conversation.Evidence{ID: conversation.ID(), Kind: "web", URL: value}
	if err := ValidURL(value); err != nil {
		return out, err
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", value, nil)
	req.Header.Set("User-Agent", "ThinkPit/1.0 (public page reader)")
	client := PublicClient()
	defer client.CloseIdleConnections()
	resp, err := client.Do(req)
	if err != nil {
		return out, errors.New("page could not be fetched; it may block access or use a private address")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return out, errors.New("page returned an unsuccessful response")
	}
	out.URL = resp.Request.URL.String()
	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/html") && !strings.Contains(ct, "text/plain") {
		return out, errors.New("page must be HTML or plain text; use file upload for documents")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024+1))
	if err != nil || len(data) > 2*1024*1024 {
		return out, errors.New("page is too large")
	}
	out.Name = resp.Request.URL.Hostname()
	if strings.Contains(ct, "html") {
		text, title := Extract(string(data))
		out.Text = text
		if title != "" {
			out.Name = title
		}
	} else {
		out.Text = string(data)
	}
	out.Text = strings.TrimSpace(out.Text)
	if len(out.Text) > 16000 {
		out.Text = out.Text[:16000]
		out.Truncated = true
	}
	if out.Text == "" {
		return out, errors.New("page contains no readable text")
	}
	return out, nil
}
func Extract(source string) (string, string) {
	node, err := html.Parse(strings.NewReader(source))
	if err != nil {
		return "", ""
	}
	var text, title strings.Builder
	var walk func(*html.Node, bool)
	walk = func(n *html.Node, inTitle bool) {
		if n.Type == html.ElementNode {
			switch n.Data {
			case "script", "style", "noscript", "svg", "nav", "footer":
				return
			}
			if n.Data == "title" {
				inTitle = true
			}
		}
		if n.Type == html.TextNode {
			value := strings.TrimSpace(n.Data)
			if value != "" {
				if inTitle {
					title.WriteString(value + " ")
				} else {
					text.WriteString(value + " ")
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c, inTitle)
		}
	}
	walk(node, false)
	return strings.Join(strings.Fields(text.String()), " "), strings.TrimSpace(title.String())
}
