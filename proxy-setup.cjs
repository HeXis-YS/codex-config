// Only set up proxy if HTTP_PROXY or HTTPS_PROXY environment variables are present
if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
