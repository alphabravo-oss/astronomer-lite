package version

var Version = "dev"

func UserAgent() string {
	return "astronomer-lite/" + Version
}
