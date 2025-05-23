# Linux
GOOS=linux GOARCH=amd64 go build -o bin/balancia-linux-amd64

# macOS (Intel)
GOOS=darwin GOARCH=amd64 go build -o bin/balancia-darwin-amd64

# macOS (Apple Silicon)
GOOS=darwin GOARCH=arm64 go build -o bin/balancia-darwin-arm64

# Windows
GOOS=windows GOARCH=amd64 go build -o bin/balancia-windows-amd64.exe
