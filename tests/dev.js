// Local preview with fake data: node tests/dev.js  (then open the printed URL)
import { startStack, PASSWORD } from './helpers.js';
const stack = await startStack();
console.log(`Dashboard (fake data): ${stack.base}  password: ${PASSWORD}`);
process.on('SIGINT', async () => { await stack.stop(); process.exit(0); });
