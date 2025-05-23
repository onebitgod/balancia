 # 📦 Project Description

Balancia is a lightweight, high-performance reverse proxy and load balancer written in Go. It simplifies routing and communication between microservices, making it ideal for modern distributed systems.

## 🔧 Features

- Reverse Proxying: Efficiently forwards client requests to appropriate backend services.
- Load Balancing: Distributes incoming traffic across multiple servers to optimize resource utilization.
- Easy Configuration: Simple setup with minimal configuration required.
- High Performance: Built with Go for fast and reliable performance.
- Extensibility: Modular design allows for easy integration and customization.

## 🚀 Use Cases
- Managing traffic between microservices in a microservices architecture.
- Distributing load among multiple instances of a service.
- Acting as a gateway for client requests in a distributed system.


## Installation Instructions
### 🔽 Download
1. Go to the [Releases](https://github.com/onebitgod/balancia/releases) page.
2. Download the binary for your OS.

### 🛠 Install System-Wide (Linux/macOS)

#### Step 1: Make the binary executable
```
chmod +x balancia-linux-amd64
```

#### Step 2: Move to a directory in your `PATH`
```
sudo mv balancia-linux-amd64 /usr/local/bin/balancia
```

Now you can run it from anywhere:
```
balancia --conf=/path/to/conf.yaml
```

## 🌐 Add to Environment (If Needed)

If `/usr/local/bin` is not in your `$PATH`, you can add it by editing your shell profile:

For bash:
```
echo 'export PATH=$PATH:/usr/local/bin' >> ~/.bashrc
source ~/.bashrc
```

For zsh:
```
echo 'export PATH=$PATH:/usr/local/bin' >> ~/.zshrc
source ~/.zshrc
```
