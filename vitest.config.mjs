import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      // nasa-proxy-server.js starts listening on load (LiteSpeed/Passenger load
      // it via require()); tests import it as a library and must not open a port.
      NASA_PROXY_NO_LISTEN: '1',
    },
  },
});
