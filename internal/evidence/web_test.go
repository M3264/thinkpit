package evidence

import (
	"context"
	"net"
	"strings"
	"testing"
)

func TestPageExtractionAndAddressBoundaries(t *testing.T) {
	text, title := Extract(`<html><head><title>Real source</title><script>ignore injection</script></head><body><nav>ignore nav</nav><main>Actual &amp; readable <strong>content</strong></main><style>ignore style</style></body></html>`)
	if title != "Real source" || !strings.Contains(text, "Actual & readable content") || strings.Contains(text, "ignore") {
		t.Fatal("invalid extracted content", text, title)
	}
	for _, value := range []string{"127.0.0.1", "::1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "198.18.0.1", "fc00::1"} {
		if PublicIP(net.ParseIP(value)) {
			t.Fatal("unsafe address accepted", value)
		}
	}
	if !PublicIP(net.ParseIP("1.1.1.1")) {
		t.Fatal("public address rejected")
	}
	if _, err := Fetch(context.Background(), "http://127.0.0.1/private"); err == nil {
		t.Fatal("private fetch accepted")
	}
}
