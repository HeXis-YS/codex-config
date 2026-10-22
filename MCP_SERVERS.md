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


## 重要说明：代理环境变量自动注入

⚠️ **MCP 服务器不会自动继承父进程的环境变量**

`proxy-setup.cjs` 已更新为自动注入代理配置，解决了以下问题：
- MCP 服务器进程启动时，即使父进程有 `HTTP_PROXY` 环境变量，子进程也可能收不到
- 导致代理配置失效，Token 替换无法工作

**当前实现**：
```javascript
// 如果环境变量未设置，自动注入默认代理配置
if (!process.env.HTTP_PROXY && !process.env.HTTPS_PROXY) {
  process.env.HTTP_PROXY = 'http://gateway.docker.internal:3128';
  process.env.HTTPS_PROXY = 'http://gateway.docker.internal:3128';
  process.env.NO_PROXY = 'localhost,127.0.0.1,::1,gateway.docker.internal';
}
```

这意味着：
- ✅ `config.toml` 中只需一行 `NODE_OPTIONS`，无需重复声明代理变量
- ✅ 所有 Node.js MCP 服务器自动获得代理支持
- ✅ 如果需要自定义代理，可以在 MCP 服务器的 `env` 节中覆盖
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

## proxy-setup.cjs 实现细节

`proxy-setup.cjs` 是一个轻量级的 Node.js 代理配置脚本，通过 `NODE_OPTIONS` 注入到 MCP 服务器进程中。

**工作原理**：
1. 检查环境变量 `HTTP_PROXY` 或 `HTTPS_PROXY` 是否存在
2. 如果存在，使用 `undici` 的 `EnvHttpProxyAgent` 设置全局 HTTP(S) 调度器
3. 所有通过 `undici` 或 Node.js `fetch` API 的请求自动走代理

**源码**：
```javascript
// Only set up proxy if HTTP_PROXY or HTTPS_PROXY environment variables are present
if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
```

**部署位置**：
- 仓库源文件：`proxy-setup.cjs`
- 安装目标：`~/.codex/proxy-setup.cjs`
- 部署脚本：`install.sh` 中的 `set_custom_provider` 函数

**依赖**：
- `undici` 包（Node.js 18+ 内置，或通过系统包管理器安装）
- 环境变量：`HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`
