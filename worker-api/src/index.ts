import { handleRequest } from './handler.ts';

export default {
  fetch(request, env) {
    return handleRequest(request, env, env.AI);
  },
} satisfies ExportedHandler<WranglerEnv>;
