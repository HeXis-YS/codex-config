# MCP 服务器配置

本仓库包含预配置的 MCP（Model Context Protocol）服务器，为 Codex 提供额外功能。

## 已配置的 MCP 服务器

### ds-websearch-mcp

**功能**：为没有原生网络搜索能力的模型提供 web_search 工具

**后端**：DeepSeek 搜索 API

**配置位置**：`config.toml` 中的 `[mcp_servers.ds-websearch-mcp]` 节

**关键特性**：
- 通过代理访问外部 API（使用 `proxy-setup.cjs`）
- 使用 placeholder token `sbx-cs-deepseek`（由代理网关自动替换为真实 token）
- 支持容器内网络隔离环境

**验证状态**：
- ✅ MCP 协议初始化成功
- ✅ 通过代理成功调用 DeepSeek 搜索 API
- ✅ 返回完整搜索结果

## 代理配置

所有 Node.js 类型的 MCP 服务器都通过以下机制走代理：

```toml
[mcp_servers.xxx.env]
NODE_OPTIONS = "--require /home/agent/.codex/proxy-setup.cjs"
```

`proxy-setup.cjs` 使用 `undici` 的 `EnvHttpProxyAgent`，自动读取环境变量：
- `HTTP_PROXY`
- `HTTPS_PROXY`
- `NO_PROXY`

## 添加新的 MCP 服务器

1. 在 `config.toml` 中添加配置：

```toml
[mcp_servers.your_server]
command = "npx"
args = ["-y", "your-mcp-package"]

[mcp_servers.your_server.env]
NODE_OPTIONS = "--require /home/agent/.codex/proxy-setup.cjs"
API_KEY = "your-api-key"
```

2. 如果是非 Node.js MCP 服务器，使用标准环境变量：
   - `HTTP_PROXY`
   - `HTTPS_PROXY`
   - 可能需要配置 `SSL_CERT_FILE`（对于 Python）

3. 运行 `install.sh` 部署配置

## 故障排查

### MCP 服务器无法访问外网

检查：
1. 代理环境变量是否正确设置（`env | grep -i proxy`）
2. `proxy-setup.cjs` 是否存在于 `~/.codex/`
3. MITM 证书是否被信任（`openssl x509 -in /tmp/proxy-ca.crt -noout -subject`）

### Token 未被替换

如果使用 placeholder token（如 `sbx-cs-*`），确保：
1. 代理网关配置了 token 替换规则
2. 请求确实通过代理（检查代理日志）

### undici 找不到

检查 Node.js 模块路径：
```bash
node -e "console.log(require.resolve('undici'))"
```

如果缺失，安装 undici：
```bash
npm install -g undici
```
