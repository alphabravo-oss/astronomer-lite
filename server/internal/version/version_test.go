package version

import "testing"

func TestUserAgent(t *testing.T) {
	if got := UserAgent(); got != "astronomer-lite/"+Version {
		t.Fatalf("UserAgent() = %q, want astronomer-lite/%s", got, Version)
	}
}
