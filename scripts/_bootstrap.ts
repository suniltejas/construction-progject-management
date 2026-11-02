import 'dotenv/config';
import { auth } from '../server/auth/auth.js';

const email = 'owner@fieldline.test';
const username = 'owner';
const password = 'TestOwner123!';

async function main(): Promise<void> {
  try {
    const existing = await auth.api.getSession?.({ headers: new Headers() });
    await auth.api.createUser({
      body: {
        email,
        name: 'Test Owner',
        password,
        role: 'user',
        data: { username, displayUsername: 'Test Owner', emailVerified: true },
      },
    });
    console.log('BOOTSTRAP_OK owner created');
  } catch (error) {
    console.error('BOOTSTRAP_ERROR', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

main();
