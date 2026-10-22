// Set proxy environment variables if not already set
// This ensures MCP servers can use the proxy even if parent process didn't pass them
if (!process.env.HTTP_PROXY && !process.env.HTTPS_PROXY) {
  process.env.HTTP_PROXY = 'http://gateway.docker.internal:3128';
  process.env.HTTPS_PROXY = 'http://gateway.docker.internal:3128';
  process.env.NO_PROXY = 'localhost,127.0.0.1,::1,gateway.docker.internal';
}

// Set up undici global dispatcher if proxy is configured
if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
